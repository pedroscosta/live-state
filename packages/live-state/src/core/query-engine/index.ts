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

export type SyncDeltaHandler = (delta: SyncDelta) => void;

interface QueryNode {
	hash: string;
	queryStep: QueryStep;
	trackedObjects: Set<string>;
	subscriptions: Set<SyncDeltaHandler>;
	parentQuery?: string;
	relationName?: string;
	childQueries: Set<string>;
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
		return toPromiseLike(this.storage.get(query)).then((results) => {
			this.ingest(query, results);
			return results;
		});
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
				queryNode = {
					hash: stepHash,
					queryStep: step,
					relationName: currentRelationName,
					trackedObjects: new Set(),
					subscriptions: new Set([callback]),
					parentQuery: lastStepHash,
					childQueries: new Set(),
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
				(matchingQueryHashes) => {
					const matchingQueriesSet = new Set(matchingQueryHashes);

					const newlyMatchedQueries: string[] = [];
					const noLongerMatchedQueries: string[] = [];
					const stillMatchedQueries: string[] = [];

					// Determine newly matched queries
					for (const queryHash of matchingQueryHashes) {
						if (previouslyMatchedQueries.has(queryHash)) {
							stillMatchedQueries.push(queryHash);
						} else {
							newlyMatchedQueries.push(queryHash);
						}
					}

					// Determine no longer matched queries
					for (const queryHash of Array.from(previouslyMatchedQueries)) {
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
					// NEXT STEP understand why this is not true (matchedQueries)
					if (
						!relatedObjNode ||
						!parentQuery ||
						!relatedObjNode.matchedQueries.has(parentQuery.hash)
					)
						return { hash: queryNode.hash, matches: false };

					return { hash: queryNode.hash, matches: true };
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
