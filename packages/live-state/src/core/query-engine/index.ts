/** biome-ignore-all lint/suspicious/noExplicitAny: no need to be more specific */

import {
	inferValue,
	type LiveObjectAny,
	type MaterializedLiveType,
	type Schema,
} from '../../schema';
import {
	applyWhere,
	extractIncludeFromWhere,
	isSubQueryInclude,
	type Logger,
} from '../../utils';
import type { RawQueryRequest, SyncDelta } from '../schemas/core-protocol';
import { toPromiseLike } from '../utils';
import type { DataSource, QueryStep } from './types';
import { hashStep } from './utils';
import { type OrderBy, type SortKey, WindowIndex } from './window-index';

export type SyncDeltaHandler = (delta: SyncDelta) => void;

interface QueryNode {
	hash: string;
	queryStep: QueryStep;
	trackedObjects: Set<string>;
	subscriptions: Set<SyncDeltaHandler>;
	parentQuery?: string;
	relationName?: string;
	childQueries: Set<string>;
	/**
	 * In-memory window ordering for a root query that declares a `limit`. Present
	 * iff this is a windowed root scope; drives scope-in / eviction / backfill
	 * broadcasts without holding row payloads (see ADR-0003).
	 */
	windowIndex?: WindowIndex;
	/** Whether `windowIndex` has been seeded from an initial resolution. */
	windowInitialized?: boolean;
	/**
	 * Per-parent window ordering for a windowed `include` (a `limit` on an
	 * `include` step), keyed by parent id. Each parent keeps its own bounded
	 * window (e.g. every project showing its latest 5 tasks); a child write is
	 * routed to the affected parent's window via its foreign key (see ADR-0003 /
	 * issue #186).
	 */
	windowIndexes?: Map<string, WindowIndex>;
	/** Parent ids whose window has been seeded from an initial resolution. */
	seededParents?: Set<string>;
}

/**
 * Scopes a windowed read to a single parent of a windowed `include`: the child's
 * foreign-key column and the parent id. `undefined` for a root window.
 */
interface ParentScope {
	column: string;
	parentId: string;
}

interface ObjectNode {
	id: string;
	type: string;
	matchedQueries: Set<string>;
	referencesObjects: Map<string, string>;
	referencedByObjects: Map<string, Set<string>>;
}

export class QueryEngine {
	private storage: DataSource;
	private schema: Schema<any>;
	private logger: Logger;
	private queryNodes: Map<string, QueryNode> = new Map();
	private objectNodes: Map<string, ObjectNode> = new Map();

	constructor(opts: {
		storage: DataSource;
		schema: Schema<any>;
		logger: Logger;
	}) {
		this.storage = opts.storage;
		this.schema = opts.schema;
		this.logger = opts.logger;
	}

	private getRelationalColumns(
		resourceName: string,
	): Map<string, { relationName: string; targetResource: string }> {
		const result = new Map<
			string,
			{ relationName: string; targetResource: string }
		>();
		const resourceSchema = this.schema[resourceName];

		if (!resourceSchema?.relations) return result;

		for (const [relationName, relation] of Object.entries(
			resourceSchema.relations,
		)) {
			// "one" relations have relationalColumn on the source entity
			if (relation.type === 'one' && relation.relationalColumn) {
				result.set(String(relation.relationalColumn), {
					relationName,
					targetResource: relation.entity.name,
				});
			}
		}

		return result;
	}

	private ensureObjectNode(
		id: string,
		type: string,
		matchedQuery?: string,
	): ObjectNode {
		let objectNode = this.objectNodes.get(id);

		if (!objectNode) {
			objectNode = {
				id,
				type,
				matchedQueries: new Set(matchedQuery ? [matchedQuery] : []),
				referencesObjects: new Map(),
				referencedByObjects: new Map(),
			};
			this.objectNodes.set(id, objectNode);
		} else if (matchedQuery) {
			objectNode.matchedQueries.add(matchedQuery);
		}

		return objectNode;
	}

	private storeRelation(
		sourceId: string,
		targetId: string,
		relationName: string,
		inverseRelationName?: string,
	): void {
		const sourceNode = this.objectNodes.get(sourceId);
		const targetNode = this.objectNodes.get(targetId);

		if (sourceNode) {
			sourceNode.referencesObjects.set(relationName, targetId);
		}

		if (targetNode && inverseRelationName) {
			let referencedBy =
				targetNode.referencedByObjects.get(inverseRelationName);
			if (!referencedBy) {
				referencedBy = new Set();
				targetNode.referencedByObjects.set(inverseRelationName, referencedBy);
			}
			referencedBy.add(sourceId);
		}
	}

	private removeRelation(
		sourceId: string,
		targetId: string,
		relationName: string,
		inverseRelationName?: string,
	): void {
		const sourceNode = this.objectNodes.get(sourceId);
		const targetNode = this.objectNodes.get(targetId);

		if (sourceNode) {
			sourceNode.referencesObjects.delete(relationName);
		}

		if (targetNode && inverseRelationName) {
			const referencedBy =
				targetNode.referencedByObjects.get(inverseRelationName);
			if (referencedBy) {
				referencedBy.delete(sourceId);
				if (referencedBy.size === 0) {
					targetNode.referencedByObjects.delete(inverseRelationName);
				}
			}
		}
	}

	private getInverseRelationName(
		sourceResource: string,
		targetResource: string,
		relationName: string,
	): string | undefined {
		const sourceSchema = this.schema[sourceResource];
		if (!sourceSchema?.relations) return undefined;

		const sourceRelation = sourceSchema.relations[relationName];
		if (!sourceRelation) return undefined;

		const targetSchema = this.schema[targetResource];
		if (!targetSchema?.relations) return undefined;

		// For a "many" relation, find the "one" relation on target with matching relationalColumn
		if (sourceRelation.type === 'many' && sourceRelation.foreignColumn) {
			for (const [inverseName, relation] of Object.entries(
				targetSchema.relations,
			)) {
				if (
					relation.entity.name === sourceResource &&
					relation.type === 'one' &&
					relation.relationalColumn === sourceRelation.foreignColumn
				) {
					return inverseName;
				}
			}
		}

		// For a "one" relation, find the "many" relation on target with matching foreignColumn
		if (sourceRelation.type === 'one' && sourceRelation.relationalColumn) {
			for (const [inverseName, relation] of Object.entries(
				targetSchema.relations,
			)) {
				if (
					relation.entity.name === sourceResource &&
					relation.type === 'many' &&
					relation.foreignColumn === sourceRelation.relationalColumn
				) {
					return inverseName;
				}
			}
		}

		return undefined;
	}

	private updateRelationsFromMutation(
		resourceName: string,
		resourceId: string,
		objValue: any,
		payload?: Record<string, any>,
	): void {
		const relationalColumns = this.getRelationalColumns(resourceName);
		const objectNode = this.objectNodes.get(resourceId);

		if (!objectNode) return;

		for (const [columnName, { relationName, targetResource }] of Array.from(
			relationalColumns,
		)) {
			const wasUpdated = payload && columnName in payload;

			if (!wasUpdated) continue;

			const inverseRelationName = this.getInverseRelationName(
				resourceName,
				targetResource,
				relationName,
			);

			const previousTargetId = objectNode.referencesObjects.get(relationName);

			const newTargetId = objValue[columnName];

			if (previousTargetId === newTargetId) continue;

			if (previousTargetId) {
				this.removeRelation(
					resourceId,
					previousTargetId,
					relationName,
					inverseRelationName,
				);
			}

			if (newTargetId) {
				this.ensureObjectNode(newTargetId, targetResource);

				this.storeRelation(
					resourceId,
					newTargetId,
					relationName,
					inverseRelationName,
				);
			}
		}
	}

	/**
	 * Resolve a Tracked Query against storage in a single query (storage owns
	 * `include` resolution) and ingest the nested result into the tracking graph
	 * so realtime matching has its object/relation state populated. See ADR-0003.
	 */
	get(query: RawQueryRequest, _extra?: { context?: any }): PromiseLike<any[]> {
		// A windowed read needs a deterministic boundary, so resolve it in the same
		// total order the window maintains (`[...orderBy, id]`); backfill reads use
		// the same tiebreaker (see ADR-0003). This holds for the root `limit` and,
		// recursively, for every windowed `include`. The extra key is harmless for
		// non-windowed callers, so only add it where a `limit` makes the window real.
		const resolveQuery: RawQueryRequest = {
			...query,
			...(query.limit !== undefined
				? {
						sort: [
							...(query.sort ?? []),
							{ key: 'id', direction: 'asc' as const },
						],
					}
				: {}),
			...(query.include
				? { include: this.withIncludeTiebreakers(query.include) }
				: {}),
		};

		return toPromiseLike(this.storage.get(resolveQuery)).then((results) => {
			this.ingest(query, results);
			return results;
		});
	}

	/**
	 * Recursively append the `id` tiebreaker to the `orderBy` of every windowed
	 * (`limit`ed) `include`, so storage seeds each per-parent window with the same
	 * total order (`[...orderBy, id]`) that `WindowIndex` and backfill/cursor reads
	 * use. Returns a new include tree; the original (used by `ingest`, whose
	 * `sortKeyFor` expects `orderBy` without the tiebreaker the window appends
	 * itself) is left untouched.
	 */
	private withIncludeTiebreakers(
		include: Record<string, any>,
	): Record<string, any> {
		const result: Record<string, any> = {};
		for (const [relName, value] of Object.entries(include)) {
			if (isSubQueryInclude(value)) {
				const nested = value.include
					? this.withIncludeTiebreakers(value.include)
					: value.include;
				result[relName] = {
					...value,
					...(nested !== undefined ? { include: nested } : {}),
					...(value.limit !== undefined
						? {
								orderBy: [
									...(value.orderBy ?? []),
									{ key: 'id', direction: 'asc' as const },
								],
							}
						: {}),
				};
			} else if (value && typeof value === 'object') {
				result[relName] = this.withIncludeTiebreakers(value);
			} else {
				result[relName] = value;
			}
		}
		return result;
	}

	/**
	 * Walk the single nested storage result alongside the query's step tree and
	 * populate the tracking graph (object nodes, relations, per-step tracked
	 * objects). Replaces the per-step side effects of the old resolution path.
	 */
	private ingest(query: RawQueryRequest, results: any[]): void {
		for (const step of this.buildSteps({ query })) {
			const objects =
				step.stepPath.length === 0
					? results
					: this.extractByPath(results, query.resource, step.stepPath);
			this.trackObjects(step, objects);
		}
	}

	/**
	 * Flatten the materialized objects nested at `stepPath` within a resolved
	 * result tree. A `many` relation nests an array of materialized objects under
	 * `.value[rel].value`; a `one` relation nests the materialized object itself
	 * under `.value[rel]` (whose `.value` is the child's field map).
	 */
	private extractByPath(
		results: any[],
		rootResource: string,
		stepPath: string[],
	): any[] {
		let level = results;
		let resource = rootResource;

		for (const relationName of stepPath) {
			const relation = this.schema[resource]?.relations?.[relationName];
			const isMany = relation?.type === 'many';
			const next: any[] = [];

			for (const item of level) {
				const node = item?.value?.[relationName];
				if (!node) continue;

				if (isMany) {
					if (Array.isArray(node.value)) {
						for (const child of node.value) if (child) next.push(child);
					}
				} else if (node.value != null) {
					next.push(node);
				}
			}

			level = next;
			if (relation) resource = relation.entity.name;
		}

		return level;
	}

	subscribe(
		query: RawQueryRequest,
		callback: SyncDeltaHandler,
		_context: any = {},
	): () => void {
		const queryPlan = this.buildSteps({ query });

		const stepHashes: Record<string, string> = {};

		const unsubscribeFunctions: (() => void)[] = [];

		for (const step of queryPlan) {
			this.logger.debug(
				'[QueryEngine] Subscribing to step',
				step.stepPath.join('.'),
			);

			const stepHash = hashStep(step);
			const lastStepHash = stepHashes[step.stepPath.at(-2) ?? ''];

			const currentRelationName = step.stepPath.at(-1) ?? '';

			let queryNode = this.queryNodes.get(stepHash);

			if (queryNode) {
				queryNode.subscriptions.add(callback);
			} else {
				const isWindowedRoot =
					step.stepPath.length === 0 && step.query.limit !== undefined;

				queryNode = {
					hash: stepHash,
					queryStep: step,
					relationName: currentRelationName,
					trackedObjects: new Set(),
					subscriptions: new Set([callback]),
					parentQuery: lastStepHash,
					childQueries: new Set(),
					windowIndex: isWindowedRoot
						? new WindowIndex({
								limit: step.query.limit as number,
								orderBy: this.orderByFor(step.query),
							})
						: undefined,
				};

				this.queryNodes.set(queryNode.hash, queryNode);

				if (lastStepHash) {
					const lastStepNode = this.queryNodes.get(lastStepHash);
					if (lastStepNode) {
						lastStepNode.childQueries.add(queryNode.hash);
					}
				}
			}

			stepHashes[currentRelationName] = stepHash;

			unsubscribeFunctions.push(() => {
				const queryNode = this.queryNodes.get(stepHash);

				if (queryNode) {
					queryNode.subscriptions.delete(callback);

					if (queryNode.subscriptions.size === 0) {
						this.queryNodes.delete(stepHash);
					}
				}
			});
		}

		return () => {
			for (const unsubscribeFunction of unsubscribeFunctions) {
				unsubscribeFunction();
			}
		};
	}

	/**
	 * Decompose a query (plus its `include` tree) into the per-relation steps
	 * that back the subscription graph. This no longer carries any resolution
	 * concern (resolution is a single `storage.get` — see ADR-0003); it only
	 * shapes the query/object node tree used for realtime matching.
	 */
	private buildSteps(queryOrOpts: {
		query: RawQueryRequest;
		stepPath?: string[];
		parentResource?: string;
	}): QueryStep[] {
		const { query, stepPath = [], parentResource } = queryOrOpts;

		const { include } = query;

		const isRootQuery = stepPath.length === 0;
		const relationName = stepPath.at(-1);

		let isMany: boolean | undefined;

		if (!isRootQuery && parentResource && relationName) {
			const relation = this.schema[parentResource]?.relations?.[relationName];
			if (relation) isMany = relation.type === 'many';
		}

		// Strip include from the query since it's been processed into child steps
		const { include: _include, ...queryWithoutInclude } = query;

		const newStep: QueryStep = {
			query: queryWithoutInclude,
			stepPath: [...stepPath],
			includedRelations:
				include && typeof include === 'object' ? Object.keys(include) : [],
			isMany,
			relationName,
		};

		const queryPlan: QueryStep[] = [newStep];

		if (
			include &&
			typeof include === 'object' &&
			Object.keys(include).length > 0
		) {
			const resourceSchema = this.schema[query.resource];

			if (!resourceSchema)
				throw new Error(`Resource ${query.resource} not found`);

			queryPlan.push(
				...Object.entries(include).flatMap(([relName, nestedInclude]) => {
					const relation = resourceSchema.relations[relName];

					if (!relation)
						throw new Error(
							`Relation ${relName} not found for resource ${query.resource}`,
						);

					const otherResourceName = relation.entity.name;

					const subQuery = isSubQueryInclude(nestedInclude)
						? nestedInclude
						: null;

					return this.buildSteps({
						query: {
							resource: otherResourceName,
							include: subQuery
								? subQuery.include
								: typeof nestedInclude === 'object'
									? nestedInclude
									: undefined,
							where: subQuery?.where,
							limit: subQuery?.limit,
							sort: subQuery?.orderBy,
						},
						stepPath: [...stepPath, relName],
						parentResource: query.resource,
					});
				}),
			);
		}

		return queryPlan;
	}

	/**
	 * Populate the tracking graph for a single step's objects: object nodes,
	 * their relations, and the step's tracked-object set. Called per step by
	 * `ingest` over the nested storage result.
	 */
	private trackObjects(step: QueryStep, results: any[]): void {
		this.logger.debug(
			'[QueryEngine] Tracking step objects',
			step.stepPath.join('.'),
			'with results',
			JSON.stringify(results, null, 2),
		);

		const stepHash = hashStep(step);
		const queryNode = this.queryNodes.get(stepHash);
		const resourceName = step.query.resource;

		if (!queryNode) return;

		const relationalColumns = this.getRelationalColumns(resourceName);

		for (const rawResult of results) {
			const result = inferValue(rawResult);
			const id = result.id;

			this.ensureObjectNode(id, resourceName, stepHash);
			queryNode.trackedObjects.add(id);

			for (const [columnName, { relationName, targetResource }] of Array.from(
				relationalColumns,
			)) {
				const targetId = result[columnName];
				if (targetId) {
					this.ensureObjectNode(targetId, targetResource);

					const inverseRelationName = this.getInverseRelationName(
						resourceName,
						targetResource,
						relationName,
					);

					this.storeRelation(id, targetId, relationName, inverseRelationName);
				}
			}

			this.loadNestedRelations(resourceName, id, result);
			this.logger.debug('[QueryEngine] Loaded nested relations for', id);
		}

		// Seed the window ordering from the storage-resolved (ordered, limited)
		// rows once. Storage returns exactly the top-N in total order, so no
		// eviction happens here (see ADR-0003).
		if (queryNode.windowIndex && !queryNode.windowInitialized) {
			for (const rawResult of results) {
				const result = inferValue(rawResult);
				if (!result?.id || queryNode.windowIndex.has(result.id)) continue;
				queryNode.windowIndex.insert({
					id: result.id,
					sortKey: this.sortKeyFor(queryNode, result),
				});
			}
			queryNode.windowInitialized = true;
		}

		// Seed the per-parent windows of a windowed `include`. Storage already
		// limited children to the top-N per parent, so grouping the flattened rows
		// by their foreign key and inserting each into its parent's window never
		// evicts. A parent is seeded only once; realtime handlers keep it current.
		const foreignColumn = this.includeForeignColumn(queryNode);
		if (foreignColumn) {
			queryNode.seededParents ??= new Set();
			for (const rawResult of results) {
				const result = inferValue(rawResult);
				const childId = result?.id;
				const parentId = result?.[foreignColumn];
				if (!childId || parentId == null) continue;
				if (queryNode.seededParents.has(parentId)) continue;
				const wi = this.ensureParentWindow(queryNode, parentId);
				if (wi.has(childId)) continue;
				wi.insert({ id: childId, sortKey: this.sortKeyFor(queryNode, result) });
			}
			for (const rawResult of results) {
				const parentId = inferValue(rawResult)?.[foreignColumn];
				if (parentId != null) queryNode.seededParents.add(parentId);
			}
		}
	}

	/** The `orderBy` a windowed root query is ordered by (empty ⇒ order by id). */
	private orderByFor(query: RawQueryRequest): OrderBy {
		return (query.sort ?? []).map((s) => ({
			key: s.key,
			direction: s.direction,
		}));
	}

	/** Extract a row's sort key (own-column values in `orderBy` order). */
	private sortKeyFor(queryNode: QueryNode, objValue: any): SortKey {
		return (queryNode.queryStep.query.sort ?? []).map((s) => objValue[s.key]);
	}

	/** The storage sort for a windowed read: `orderBy` plus the id tiebreaker. */
	private storageSortFor(queryNode: QueryNode): RawQueryRequest['sort'] {
		return [
			...(queryNode.queryStep.query.sort ?? []),
			{ key: 'id', direction: 'asc' as const },
		];
	}

	/**
	 * The foreign-key column on a windowed `include`'s child that points back at
	 * its parent (the `foreignColumn` of the parent's `many` relation). Returns
	 * `undefined` for a node that is not a windowed `many` include, which is the
	 * signal used to recognize per-parent windows.
	 */
	private includeForeignColumn(queryNode: QueryNode): string | undefined {
		if (
			queryNode.queryStep.stepPath.length === 0 ||
			queryNode.queryStep.query.limit === undefined ||
			!queryNode.relationName ||
			!queryNode.parentQuery
		)
			return undefined;

		const parentNode = this.queryNodes.get(queryNode.parentQuery);
		const parentResource = parentNode?.queryStep.query.resource;
		if (!parentResource) return undefined;

		const relation =
			this.schema[parentResource]?.relations?.[queryNode.relationName];
		if (relation?.type !== 'many' || !relation.foreignColumn) return undefined;

		return String(relation.foreignColumn);
	}

	/** Whether a query node maintains per-parent windows (a windowed `include`). */
	private isWindowedIncludeNode(queryNode: QueryNode): boolean {
		return this.includeForeignColumn(queryNode) !== undefined;
	}

	/** Get (or lazily create) the window for one parent of a windowed `include`. */
	private ensureParentWindow(
		queryNode: QueryNode,
		parentId: string,
	): WindowIndex {
		if (!queryNode.windowIndexes) queryNode.windowIndexes = new Map();
		let wi = queryNode.windowIndexes.get(parentId);
		if (!wi) {
			wi = new WindowIndex({
				limit: queryNode.queryStep.query.limit as number,
				orderBy: this.orderByFor(queryNode.queryStep.query),
			});
			queryNode.windowIndexes.set(parentId, wi);
		}
		return wi;
	}

	/** Find the parent window currently holding a child, if any. */
	private parentWindowHolding(
		queryNode: QueryNode,
		id: string,
	): { parentId: string; wi: WindowIndex } | undefined {
		if (!queryNode.windowIndexes) return undefined;
		for (const [parentId, wi] of Array.from(queryNode.windowIndexes)) {
			if (wi.has(id)) return { parentId, wi };
		}
		return undefined;
	}

	/** Emit a delta to every subscriber of a query node, isolating callback errors. */
	private emitToSubscribers(
		queryNode: QueryNode,
		delta: SyncDelta,
		context: string,
	): void {
		for (const subscription of Array.from(queryNode.subscriptions)) {
			try {
				subscription(delta);
			} catch (error) {
				this.logger.error(
					`[QueryEngine] Error in subscription during ${context}`,
					{
						error,
						queryHash: queryNode.hash,
						resource: delta.resource,
						resourceId: delta.resourceId,
					},
				);
			}
		}
	}

	/**
	 * Broadcast a scope-out: drop the row from this window's tracking and emit an
	 * id-only `DELETE`. Used for both evictions (displaced by an insert) and rows
	 * that left scope; neither requires a database read.
	 */
	private emitScopeOut(
		queryNode: QueryNode,
		resourceId: string,
		meta?: SyncDelta['meta'],
	): void {
		queryNode.trackedObjects.delete(resourceId);
		this.objectNodes.get(resourceId)?.matchedQueries.delete(queryNode.hash);
		this.emitToSubscribers(
			queryNode,
			{
				type: 'SYNC',
				op: 'DELETE',
				resource: queryNode.queryStep.query.resource,
				resourceId,
				payload: {},
				meta,
			},
			'scope-out DELETE',
		);
	}

	/**
	 * Handle an INSERT against a windowed root query: place the row in the window
	 * (payload straight from the triggering mutation) and, if it displaced the
	 * boundary of a full window, broadcast the eviction as an id-only `DELETE`.
	 */
	private handleWindowedInsert(
		queryNode: QueryNode,
		wi: WindowIndex,
		mutation: SyncDelta,
		objValue: any,
	): void {
		const result = wi.insert({
			id: mutation.resourceId,
			sortKey: this.sortKeyFor(queryNode, objValue),
		});

		// Sorted past the boundary of a full window: not in scope, emit nothing.
		if (!result.inserted) return;

		queryNode.trackedObjects.add(mutation.resourceId);
		this.objectNodes
			.get(mutation.resourceId)
			?.matchedQueries.add(queryNode.hash);
		this.emitToSubscribers(queryNode, mutation, 'windowed scope-in INSERT');

		if (result.evicted) {
			this.emitScopeOut(queryNode, result.evicted.id, mutation.meta);
		}
	}

	/**
	 * Handle an UPDATE against a windowed root query. Membership is judged per
	 * ADR-0003: a row staying in the window is a plain field `UPDATE` (within-
	 * window reordering is left to the client to re-sort); a row entering scope
	 * is a scope-in `INSERT` (possibly evicting the boundary); a row leaving
	 * scope is a `DELETE` followed by a single boundary-cursor backfill read.
	 */
	private async handleWindowedUpdate(
		queryNode: QueryNode,
		mutation: SyncDelta,
		entityValue: MaterializedLiveType<LiveObjectAny>,
		objValue: any,
		predicateMatches: boolean,
	): Promise<void> {
		const wi = queryNode.windowIndex;
		if (!wi) return;

		const id = mutation.resourceId;
		const wasInWindow = wi.has(id);

		if (predicateMatches) {
			if (wasInWindow) {
				await this.refreshInWindow(queryNode, wi, mutation, objValue);
				return;
			}

			this.scopeInViaUpdate(queryNode, wi, mutation, entityValue, objValue);
			return;
		}

		// Predicate no longer matches: scope-out, then backfill the freed slot.
		if (wasInWindow) {
			wi.remove(id);
			this.emitScopeOut(queryNode, id, mutation.meta);
			await this.backfillWindow(queryNode, wi, mutation.meta);
		}
	}

	/**
	 * Refresh the sort key of a row that stays in a window after an update. If the
	 * row's own sort key worsened enough to land it at the boundary of a full
	 * window, an untracked row just outside may now sort ahead of it — the
	 * window-local re-insert can't see that, so a single boundary read confirms
	 * (see `reconcileDemotion`). Otherwise the field change is broadcast as a
	 * plain `UPDATE` (within-window reordering is left to the client).
	 */
	private async refreshInWindow(
		queryNode: QueryNode,
		wi: WindowIndex,
		mutation: SyncDelta,
		objValue: any,
		parentScope?: ParentScope,
	): Promise<void> {
		const id = mutation.resourceId;
		const sortKey = this.sortKeyFor(queryNode, objValue);

		// Removing first frees a slot so the re-insert never evicts.
		const prevKey = wi.remove(id)?.sortKey;
		wi.insert({ id, sortKey });

		if (
			wi.isFull &&
			wi.boundary()?.id === id &&
			!this.sortKeysEqual(prevKey, sortKey)
		) {
			await this.reconcileDemotion(
				queryNode,
				wi,
				id,
				sortKey,
				mutation,
				parentScope,
			);
			return;
		}

		this.emitToSubscribers(queryNode, mutation, 'windowed UPDATE');
	}

	/**
	 * Bring a row into a window via an update. The mutation payload is partial, so
	 * carry the full object as the INSERT payload; a displaced boundary is emitted
	 * as an id-only eviction `DELETE`.
	 */
	private scopeInViaUpdate(
		queryNode: QueryNode,
		wi: WindowIndex,
		mutation: SyncDelta,
		entityValue: MaterializedLiveType<LiveObjectAny>,
		objValue: any,
	): void {
		const id = mutation.resourceId;
		const result = wi.insert({
			id,
			sortKey: this.sortKeyFor(queryNode, objValue),
		});
		if (!result.inserted) return;

		queryNode.trackedObjects.add(id);
		this.objectNodes.get(id)?.matchedQueries.add(queryNode.hash);
		this.emitToSubscribers(
			queryNode,
			this.fullInsertDelta(queryNode, mutation, entityValue),
			'windowed scope-in INSERT',
		);
		if (result.evicted) {
			this.emitScopeOut(queryNode, result.evicted.id, mutation.meta);
		}
	}

	/**
	 * Membership update for a windowed `include`, judged per parent list
	 * (ADR-0003). Finds the parent window that currently holds the child and the
	 * parent the child now belongs to, then:
	 * - same list → a plain field `UPDATE` (or a boundary reconcile);
	 * - left the old list (removed / re-parented / predicate-out) → `DELETE` to
	 *   that parent's subscribers plus a backfill of its freed slot;
	 * - entered a new list → scope-in `INSERT` (payload from the mutation) plus
	 *   any eviction on that parent's boundary.
	 *
	 * Re-parenting A→B therefore decomposes into a `DELETE`+backfill on A and an
	 * `INSERT` on B; unrelated parents are untouched.
	 */
	private async handleWindowedIncludeUpdate(
		queryNode: QueryNode,
		mutation: SyncDelta,
		entityValue: MaterializedLiveType<LiveObjectAny>,
		objValue: any,
		belongsToNewParent: boolean,
	): Promise<void> {
		const foreignColumn = this.includeForeignColumn(queryNode);
		if (!foreignColumn) return;

		const id = mutation.resourceId;
		const newParentId = belongsToNewParent
			? (objValue[foreignColumn] as string | undefined)
			: undefined;
		const held = this.parentWindowHolding(queryNode, id);
		const oldParentId = held?.parentId;

		// Same list: refresh in place (field UPDATE or boundary reconcile).
		if (oldParentId !== undefined && oldParentId === newParentId) {
			await this.refreshInWindow(queryNode, held!.wi, mutation, objValue, {
				column: foreignColumn,
				parentId: oldParentId,
			});
			return;
		}

		// Left the old list: DELETE to A's subscribers, then backfill A.
		if (held) {
			held.wi.remove(id);
			this.emitScopeOut(queryNode, id, mutation.meta);
			await this.backfillWindow(queryNode, held.wi, mutation.meta, {
				column: foreignColumn,
				parentId: held.parentId,
			});
		}

		// Entered a new list: scope-in INSERT (+ eviction) on B.
		if (newParentId !== undefined) {
			const wi = this.ensureParentWindow(queryNode, newParentId);
			if (!wi.has(id)) {
				this.scopeInViaUpdate(queryNode, wi, mutation, entityValue, objValue);
			}
		}
	}

	/** Element-wise equality of two sort keys (both `undefined`-safe). */
	private sortKeysEqual(a: SortKey | undefined, b: SortKey): boolean {
		if (!a || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}

	/**
	 * Resolve an in-window row whose own sort key worsened to the boundary of a
	 * full window: a single boundary read finds the best untracked row past the
	 * preceding entry. If that row outranks the demoted one they are swapped
	 * (scope-out `DELETE` + backfill `INSERT`); otherwise the demoted row keeps
	 * its slot and only a field `UPDATE` is broadcast. The demoted row is already
	 * re-inserted at the boundary on entry.
	 */
	private async reconcileDemotion(
		queryNode: QueryNode,
		wi: WindowIndex,
		id: string,
		sortKey: SortKey,
		mutation: SyncDelta,
		parentScope?: ParentScope,
	): Promise<void> {
		// Free the boundary slot so the cursor is the row *before* the demoted one;
		// the demoted row still lives in storage past that cursor, so skip it.
		wi.remove(id);
		const resource = queryNode.queryStep.query.resource;
		const where = this.windowReadWhere(queryNode, wi, parentScope);

		const rows = await toPromiseLike(
			this.storage.get({
				resource,
				where,
				sort: this.storageSortFor(queryNode),
				limit: 2,
			}),
		);

		let candidate: any;
		let candidateRow: any;
		for (const row of rows) {
			const value = inferValue(row);
			if (!value?.id || value.id === id || wi.has(value.id)) continue;
			candidate = value;
			candidateRow = row;
			break;
		}

		if (!candidate) {
			// Nothing outside the window: the demoted row rightfully keeps its slot.
			wi.insert({ id, sortKey });
			this.emitToSubscribers(queryNode, mutation, 'windowed UPDATE');
			return;
		}

		wi.insert({
			id: candidate.id,
			sortKey: this.sortKeyFor(queryNode, candidate),
		});

		// Full window with `candidate` at the boundary: re-inserting the demoted row
		// either evicts `candidate` (it still outranks it) or is rejected (it does
		// not). Either way the window ends in the correct state.
		if (wi.insert({ id, sortKey }).inserted) {
			this.emitToSubscribers(queryNode, mutation, 'windowed UPDATE');
			return;
		}

		queryNode.trackedObjects.add(candidate.id);
		this.ensureObjectNode(
			candidate.id,
			resource,
			queryNode.hash,
		).matchedQueries.add(queryNode.hash);
		const payload = { ...((candidateRow as any)?.value ?? {}) };
		delete payload.id;
		this.emitToSubscribers(
			queryNode,
			{
				type: 'SYNC',
				op: 'INSERT',
				resource,
				resourceId: candidate.id,
				payload,
				meta: mutation.meta,
			},
			'windowed demotion backfill INSERT',
		);
		this.emitScopeOut(queryNode, id, mutation.meta);
	}

	/** Build a full-object INSERT delta from the mutated entity's own columns. */
	private fullInsertDelta(
		queryNode: QueryNode,
		mutation: SyncDelta,
		entityValue: MaterializedLiveType<LiveObjectAny>,
	): SyncDelta {
		const payload = { ...((entityValue as any)?.value ?? {}) };
		delete payload.id;
		return {
			type: 'SYNC',
			op: 'INSERT',
			resource: queryNode.queryStep.query.resource,
			resourceId: mutation.resourceId,
			payload,
			meta: mutation.meta,
		};
	}

	/**
	 * Refill an under-full window with the next rows past its boundary via a
	 * single boundary-cursor read (`where AND sortKey beyond the last remaining
	 * visible row, orderBy [...,id], limit = rows needed`). Each backfilled row is
	 * broadcast as a scope-in `INSERT`. This is the one database read on the
	 * broadcast path (see ADR-0003).
	 */
	private async backfillWindow(
		queryNode: QueryNode,
		wi: WindowIndex,
		meta?: SyncDelta['meta'],
		parentScope?: ParentScope,
	): Promise<void> {
		const need = wi.backfillCount;
		if (need <= 0) return;

		const resource = queryNode.queryStep.query.resource;
		const where = this.windowReadWhere(queryNode, wi, parentScope);

		const rows = await toPromiseLike(
			this.storage.get({
				resource,
				where,
				sort: this.storageSortFor(queryNode),
				limit: need,
			}),
		);

		for (const row of rows) {
			const value = inferValue(row);
			if (!value?.id || wi.has(value.id)) continue;

			wi.insert({ id: value.id, sortKey: this.sortKeyFor(queryNode, value) });
			queryNode.trackedObjects.add(value.id);
			this.ensureObjectNode(
				value.id,
				resource,
				queryNode.hash,
			).matchedQueries.add(queryNode.hash);

			const payload = { ...((row as any)?.value ?? {}) };
			delete payload.id;
			this.emitToSubscribers(
				queryNode,
				{
					type: 'SYNC',
					op: 'INSERT',
					resource,
					resourceId: value.id,
					payload,
					meta,
				},
				'windowed backfill INSERT',
			);
		}
	}

	/**
	 * Cursor predicate selecting rows strictly after `boundary` in the total order
	 * `[...orderBy, id]`: `OR_i ( AND_{j<i} k_j = v_j AND k_i <cmp> v_i )`, where
	 * `<cmp>` is `$gt` for ascending keys and `$lt` for descending. Returns
	 * `undefined` when the window is empty (no cursor — take the top rows).
	 */
	private buildCursorWhere(
		queryNode: QueryNode,
		boundary: { id: string; sortKey: SortKey } | undefined,
	): Record<string, any> | undefined {
		if (!boundary) return undefined;

		const keys = [
			...(queryNode.queryStep.query.sort ?? []),
			{ key: 'id', direction: 'asc' as const },
		];
		const values = [...boundary.sortKey, boundary.id];

		const clauses: Record<string, any>[] = [];
		for (let i = 0; i < keys.length; i++) {
			const conds: Record<string, any>[] = [];
			for (let j = 0; j < i; j++) conds.push({ [keys[j].key]: values[j] });
			const op = keys[i].direction === 'desc' ? '$lt' : '$gt';
			conds.push({ [keys[i].key]: { [op]: values[i] } });
			clauses.push(conds.length === 1 ? conds[0] : { $and: conds });
		}

		return clauses.length === 1 ? clauses[0] : { $or: clauses };
	}

	/**
	 * The `where` for a windowed boundary read: the query's base `where`, scoped to
	 * a single parent (`foreignColumn = parentId`) for a windowed `include`, plus
	 * the boundary cursor predicate.
	 */
	private windowReadWhere(
		queryNode: QueryNode,
		wi: WindowIndex,
		parentScope?: ParentScope,
	): Record<string, any> | undefined {
		let where = queryNode.queryStep.query.where;
		if (parentScope) {
			where = this.combineWhere(where, {
				[parentScope.column]: parentScope.parentId,
			});
		}
		return this.combineWhere(
			where,
			this.buildCursorWhere(queryNode, wi.boundary()),
		);
	}

	/** Combine a query's base `where` with a cursor predicate (both optional). */
	private combineWhere(
		base: Record<string, any> | undefined,
		cursor: Record<string, any> | undefined,
	): Record<string, any> | undefined {
		if (!cursor) return base;
		if (!base || Object.keys(base).length === 0) return cursor;
		return { $and: [base, cursor] };
	}

	private loadNestedRelations(
		resourceName: string,
		objectId: string,
		data: any,
	): void {
		const resourceSchema = this.schema[resourceName];
		if (!resourceSchema?.relations) return;

		for (const [relationName, relation] of Object.entries(
			resourceSchema.relations,
		)) {
			const nestedData = data[relationName];
			if (!nestedData) continue;

			const targetResource = relation.entity.name;
			const inverseRelationName = this.getInverseRelationName(
				resourceName,
				targetResource,
				relationName,
			);

			if (relation.type === 'one') {
				if (nestedData && typeof nestedData === 'object' && nestedData.id) {
					this.ensureObjectNode(nestedData.id, targetResource);
					this.storeRelation(
						objectId,
						nestedData.id,
						relationName,
						inverseRelationName,
					);
					this.loadNestedRelations(targetResource, nestedData.id, nestedData);
				}
			} else if (relation.type === 'many') {
				if (Array.isArray(nestedData)) {
					for (const item of nestedData) {
						if (item && typeof item === 'object' && item.id) {
							this.ensureObjectNode(item.id, targetResource);
							// For "many" relations, the relation is stored on the child pointing to parent
							// But we also track the reverse reference
							const reverseInverse = this.getInverseRelationName(
								targetResource,
								resourceName,
								relationName,
							);
							if (reverseInverse) {
								this.storeRelation(
									item.id,
									objectId,
									reverseInverse,
									relationName,
								);
							}
							this.loadNestedRelations(targetResource, item.id, item);
						}
					}
				}
			}
		}
	}

	/**
	 * Builds an include object from a query node's child queries recursively.
	 * This allows fetching related data when an object moves into scope.
	 */
	private buildIncludeFromChildQueries(queryHash: string): Record<string, any> {
		const queryNode = this.queryNodes.get(queryHash);
		if (!queryNode || queryNode.childQueries.size === 0) return {};

		const include: Record<string, any> = {};

		for (const childHash of Array.from(queryNode.childQueries)) {
			const childNode = this.queryNodes.get(childHash);
			if (!childNode || !childNode.relationName) continue;

			const nestedInclude = this.buildIncludeFromChildQueries(childHash);

			include[childNode.relationName] =
				Object.keys(nestedInclude).length > 0 ? nestedInclude : true;
		}

		return include;
	}

	/**
	 * Recursively sends INSERT mutations for an object and all its included relations.
	 * This is used when an object moves into scope to notify subscribers of the entire tree.
	 */
	private sendInsertsForTree(
		queryNode: QueryNode,
		data: any,
		resourceName: string,
		meta?: SyncDelta['meta'],
	): void {
		const id = data?.value?.id?.value as string | undefined;
		if (!id) return;

		// Send INSERT for this object. Carry the source mutation's meta so the
		// originating client can reconcile optimistic state via originMutationId.
		const insertMutation: SyncDelta = {
			op: 'INSERT',
			resource: resourceName,
			resourceId: id,
			type: 'SYNC',
			payload: data.value,
			meta,
		};

		for (const subscription of Array.from(queryNode.subscriptions)) {
			try {
				subscription(insertMutation);
			} catch (error) {
				this.logger.error(
					'[QueryEngine] Error in subscription callback during sendInsertsForTree',
					{
						error,
						queryHash: queryNode.hash,
						resource: resourceName,
						resourceId: id,
						stepPath: queryNode.queryStep.stepPath.join('.'),
					},
				);
			}
		}

		// Track this object in the query
		queryNode.trackedObjects.add(id);
		const objectNode = this.ensureObjectNode(id, resourceName, queryNode.hash);
		objectNode.matchedQueries.add(queryNode.hash);

		// Process child queries and send INSERTs for related objects
		for (const childHash of Array.from(queryNode.childQueries)) {
			const childQueryNode = this.queryNodes.get(childHash);
			if (!childQueryNode || !childQueryNode.relationName) continue;

			const relationName = childQueryNode.relationName;
			const childResource = childQueryNode.queryStep.query.resource;
			const relatedData = data.value[relationName];

			if (!relatedData) continue;

			// Handle both single objects and arrays
			const relatedItems = relatedData.value;
			if (Array.isArray(relatedItems)) {
				for (const item of relatedItems) {
					this.sendInsertsForTree(childQueryNode, item, childResource, meta);
				}
			} else if (relatedItems && typeof relatedItems === 'object') {
				this.sendInsertsForTree(
					childQueryNode,
					relatedItems,
					childResource,
					meta,
				);
			}
		}
	}

	public handleMutation(
		mutation: SyncDelta,
		entityValue: MaterializedLiveType<LiveObjectAny>,
	) {
		if (mutation.op === 'INSERT') {
			if (this.objectNodes.has(mutation.resourceId)) return;

			const objValue = inferValue(entityValue);

			if (!objValue) return;

			const newObjectNode: ObjectNode = {
				id: mutation.resourceId,
				type: mutation.resource,
				matchedQueries: new Set(),
				referencesObjects: new Map(),
				referencedByObjects: new Map(),
			};

			this.objectNodes.set(mutation.resourceId, newObjectNode);

			const relationalColumns = this.getRelationalColumns(mutation.resource);
			for (const [columnName, { relationName, targetResource }] of Array.from(
				relationalColumns,
			)) {
				const targetId = objValue[columnName];
				if (targetId) {
					this.ensureObjectNode(targetId, targetResource);

					const inverseRelationName = this.getInverseRelationName(
						mutation.resource,
						targetResource,
						relationName,
					);

					this.storeRelation(
						mutation.resourceId,
						targetId,
						relationName,
						inverseRelationName,
					);
				}
			}

			const storedObjectNode = this.objectNodes.get(mutation.resourceId);

			this.getMatchingQueries(mutation, objValue).then((matchingQueries) => {
				for (const queryHash of matchingQueries) {
					const queryNode = this.queryNodes.get(queryHash);

					if (!queryNode) continue; // TODO should we throw an error here?

					if (queryNode.windowIndex) {
						this.handleWindowedInsert(
							queryNode,
							queryNode.windowIndex,
							mutation,
							objValue,
						);
						continue;
					}

					// Windowed `include`: route the child to its parent's window via the
					// foreign key. `getMatchingQueries` already confirmed the parent is in
					// scope, so the FK value is a tracked parent.
					const foreignColumn = this.includeForeignColumn(queryNode);
					if (foreignColumn) {
						const parentId = objValue[foreignColumn];
						if (parentId != null) {
							this.handleWindowedInsert(
								queryNode,
								this.ensureParentWindow(queryNode, parentId),
								mutation,
								objValue,
							);
						}
						continue;
					}

					queryNode.trackedObjects.add(mutation.resourceId);

					if (storedObjectNode) {
						storedObjectNode.matchedQueries.add(queryHash);
					}

					for (const subscription of Array.from(queryNode.subscriptions)) {
						try {
							subscription(mutation);
						} catch (error) {
							this.logger.error(
								'[QueryEngine] Error in subscription callback during INSERT mutation',
								{
									error,
									queryHash: queryNode.hash,
									resource: mutation.resource,
									resourceId: mutation.resourceId,
									stepPath: queryNode.queryStep.stepPath.join('.'),
								},
							);
						}
					}
				}
			});

			return;
		}
		if (mutation.op === 'UPDATE') {
			const objValue = inferValue(entityValue);

			if (!objValue) return;

			// Step 1: Ensure object node exists and update object relations first
			let objectNode = this.objectNodes.get(mutation.resourceId);
			const previouslyMatchedQueries = new Set(
				objectNode?.matchedQueries ?? [],
			);

			if (!objectNode) {
				objectNode = {
					id: mutation.resourceId,
					type: mutation.resource,
					matchedQueries: new Set(),
					referencesObjects: new Map(),
					referencedByObjects: new Map(),
				};
				this.objectNodes.set(mutation.resourceId, objectNode);
			}

			// Update object relations before checking query matching
			this.updateRelationsFromMutation(
				mutation.resource,
				mutation.resourceId,
				objValue,
				mutation.payload,
			);

			// Step 2: Use getMatchingQueries to determine current matching state
			this.getMatchingQueries(mutation, objValue).then(
				async (matchingQueryHashes) => {
					const matchingQueriesSet = new Set(matchingQueryHashes);

					// Windowed root scopes decide membership by window position, not by
					// the predicate alone, so they are handled separately (scope-in /
					// eviction / backfill) and excluded from the plain partition below.
					const windowedHashes = new Set<string>();
					for (const queryNode of Array.from(this.queryNodes.values())) {
						if (queryNode.queryStep.query.resource !== mutation.resource)
							continue;

						if (queryNode.windowIndex) {
							windowedHashes.add(queryNode.hash);
							await this.handleWindowedUpdate(
								queryNode,
								mutation,
								entityValue,
								objValue,
								matchingQueriesSet.has(queryNode.hash),
							);
						} else if (this.isWindowedIncludeNode(queryNode)) {
							windowedHashes.add(queryNode.hash);
							await this.handleWindowedIncludeUpdate(
								queryNode,
								mutation,
								entityValue,
								objValue,
								matchingQueriesSet.has(queryNode.hash),
							);
						}
					}

					const newlyMatchedQueries: string[] = [];
					const noLongerMatchedQueries: string[] = [];
					const stillMatchedQueries: string[] = [];

					// Determine newly matched queries
					for (const queryHash of matchingQueryHashes) {
						if (windowedHashes.has(queryHash)) continue;
						if (previouslyMatchedQueries.has(queryHash)) {
							stillMatchedQueries.push(queryHash);
						} else {
							newlyMatchedQueries.push(queryHash);
						}
					}

					// Determine no longer matched queries
					for (const queryHash of Array.from(previouslyMatchedQueries)) {
						if (windowedHashes.has(queryHash)) continue;
						if (!matchingQueriesSet.has(queryHash)) {
							noLongerMatchedQueries.push(queryHash);
						}
					}

					// Update query node tracking
					for (const queryHash of newlyMatchedQueries) {
						const queryNode = this.queryNodes.get(queryHash);
						if (queryNode) {
							queryNode.trackedObjects.add(mutation.resourceId);
						}
					}

					for (const queryHash of noLongerMatchedQueries) {
						const queryNode = this.queryNodes.get(queryHash);
						if (queryNode) {
							queryNode.trackedObjects.delete(mutation.resourceId);
						}
					}

					// Update object node matched queries
					const currentObjectNode = this.objectNodes.get(mutation.resourceId);
					if (currentObjectNode) {
						for (const queryHash of newlyMatchedQueries) {
							currentObjectNode.matchedQueries.add(queryHash);
						}
						for (const queryHash of noLongerMatchedQueries) {
							currentObjectNode.matchedQueries.delete(queryHash);
						}
					}

					// Notify subscriptions for still matched and no longer matched queries
					for (const queryHash of [
						...noLongerMatchedQueries,
						...stillMatchedQueries,
					]) {
						const queryNode = this.queryNodes.get(queryHash);

						if (!queryNode) continue;

						for (const subscription of Array.from(queryNode.subscriptions)) {
							try {
								subscription(mutation);
							} catch (error) {
								this.logger.error(
									'[QueryEngine] Error in subscription callback during UPDATE mutation',
									{
										error,
										queryHash: queryNode.hash,
										resource: mutation.resource,
										resourceId: mutation.resourceId,
										stepPath: queryNode.queryStep.stepPath.join('.'),
									},
								);
							}
						}
					}

					// For newly matched queries, fetch full data with includes and send INSERT mutations
					// for the object and all its children down the tree
					if (newlyMatchedQueries.length > 0) {
						for (const queryHash of newlyMatchedQueries) {
							const queryNode = this.queryNodes.get(queryHash);

							if (!queryNode) continue;

							// Build include structure from child queries
							const include = this.buildIncludeFromChildQueries(queryHash);

							this.get({
								resource: mutation.resource,
								where: { id: mutation.resourceId },
								include: Object.keys(include).length > 0 ? include : undefined,
							}).then((results: any[]) => {
								if (!results || results.length === 0) return;

								// Send INSERT for the main object and all its included children
								this.sendInsertsForTree(
									queryNode,
									results[0],
									mutation.resource,
									mutation.meta,
								);
							});
						}
					}
				},
			);

			return;
		}
	}

	getMatchingQueries(
		mutation: SyncDelta,
		objValue: any,
	): PromiseLike<string[]> {
		const queriesToCheck: QueryNode[] = [];

		// TODO map queries by resource
		for (const queryNode of Array.from(this.queryNodes.values())) {
			if (queryNode.queryStep.query.resource !== mutation.resource) continue;
			queriesToCheck.push(queryNode);
		}

		if (queriesToCheck.length === 0) return toPromiseLike([]);

		return Promise.all(
			queriesToCheck.map(async (queryNode) => {
				const where = queryNode.queryStep.query.where;
				const resource = queryNode.queryStep.query.resource;
				const resourceId = mutation.resourceId;
				const objectNode = this.objectNodes.get(resourceId);

				if (!objectNode) return { hash: queryNode.hash, matches: false };

				if (queryNode.relationName) {
					// queryNode.relationName is the relation from the parent's perspective (e.g., "posts" on User)
					// but referencesObjects uses the relation from this object's perspective (e.g., "author" on Post)
					// So we need to find the inverse relation name
					const parentQuery = queryNode.parentQuery
						? this.queryNodes.get(queryNode.parentQuery)
						: undefined;
					const parentResource = parentQuery?.queryStep.query.resource;

					const inverseRelationName = parentResource
						? this.getInverseRelationName(
								parentResource,
								resource,
								queryNode.relationName,
							)
						: undefined;

					const relatedObj = inverseRelationName
						? objectNode.referencesObjects.get(inverseRelationName)
						: undefined;
					if (!relatedObj) return { hash: queryNode.hash, matches: false };

					const relatedObjNode = this.objectNodes.get(relatedObj);
					if (
						!relatedObjNode ||
						!parentQuery ||
						!relatedObjNode.matchedQueries.has(parentQuery.hash)
					)
						return { hash: queryNode.hash, matches: false };

					// Relation membership holds; fall through to re-apply the
					// include's own `where` predicate so a related-but-filtered-out
					// object is not broadcast to this query's subscribers (ADR-0003).
				}

				if (!where) {
					return { hash: queryNode.hash, matches: true };
				}

				const include = extractIncludeFromWhere(where, resource, this.schema);
				const hasRelations = Object.keys(include).length > 0;

				if (!hasRelations && objValue !== undefined) {
					return { hash: queryNode.hash, matches: applyWhere(objValue, where) };
				}

				const fullObject = await this.storage.get({
					resource,
					where: { id: resourceId },
					include: hasRelations ? include : undefined,
				});

				if (!fullObject || fullObject.length === 0) {
					return { hash: queryNode.hash, matches: false };
				}

				const fullObjValue = inferValue(fullObject[0]);

				if (!fullObjValue) {
					return { hash: queryNode.hash, matches: false };
				}

				return {
					hash: queryNode.hash,
					matches: applyWhere(fullObjValue, where),
				};
			}),
		).then((results) => {
			return results
				.filter((result) => result.matches)
				.map((result) => result.hash);
		});
	}
}
