/** biome-ignore-all lint/suspicious/noExplicitAny: tracked rows are dynamically shaped */

import type { Schema } from '../../schema';
import { inverseRelationName, relationalColumns } from './schema-relations';

/**
 * One tracked object. Holds only its edges and query membership — never a row
 * payload. `references` maps a relation name to the id it points at (its
 * outgoing FK edges); `referencedBy` maps an inverse relation name to the ids
 * pointing back (its inbound edges); `matchedQueries` is the set of query hashes
 * this object currently matches.
 */
interface ObjectNode {
	matchedQueries: Set<string>;
	references: Map<string, string>;
	referencedBy: Map<string, Set<string>>;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The query engine's in-memory graph of tracked objects and the relations
 * between them (see `CONTEXT.md` → Relation Graph, ADR-0003). It owns the paired
 * `references`/`referencedBy` invariant and all inverse-relation-name resolution
 * internally: callers traverse edges in query-relation terms and never compute an
 * inverse name.
 *
 * Writes enter through two methods: `ingest` (a resolved, possibly nested storage
 * tree; purely additive) and `applyWrite` (a mutation; diff-aware). Reads answer
 * relation-membership matching (`reference`, `matches`) and the reverse-ref
 * fan-out (`referencedBy`). Holds no row payloads and never removes a node.
 */
export class RelationGraph {
	private readonly schema: Schema<any>;
	private readonly nodes: Map<string, ObjectNode> = new Map();

	constructor(schema: Schema<any>) {
		this.schema = schema;
	}

	private ensureNode(id: string): ObjectNode {
		let node = this.nodes.get(id);
		if (!node) {
			node = {
				matchedQueries: new Set(),
				references: new Map(),
				referencedBy: new Map(),
			};
			this.nodes.set(id, node);
		}
		return node;
	}

	/** Wire an edge in both directions (source → target, and the inverse back). */
	private link(
		sourceId: string,
		targetId: string,
		relationName: string,
		inverseName: string | undefined,
	): void {
		this.ensureNode(sourceId).references.set(relationName, targetId);
		if (!inverseName) return;
		const target = this.ensureNode(targetId);
		let refs = target.referencedBy.get(inverseName);
		if (!refs) {
			refs = new Set();
			target.referencedBy.set(inverseName, refs);
		}
		refs.add(sourceId);
	}

	/** Remove an edge in both directions. */
	private unlink(
		sourceId: string,
		targetId: string,
		relationName: string,
		inverseName: string | undefined,
	): void {
		this.nodes.get(sourceId)?.references.delete(relationName);
		if (!inverseName) return;
		const refs = this.nodes.get(targetId)?.referencedBy.get(inverseName);
		if (!refs) return;
		refs.delete(sourceId);
		if (refs.size === 0)
			this.nodes.get(targetId)?.referencedBy.delete(inverseName);
	}

	/**
	 * Ingest a resolved storage row (its inferred value, relations nested inline)
	 * into the graph: create its node, wire its outgoing FK edges, and recurse
	 * through any nested `one`/`many` relations. Purely additive and idempotent —
	 * used for resolution, backfill, and promotion reads.
	 */
	ingest(resource: string, row: any): void {
		const id = row?.id;
		if (!id) return;
		this.ensureNode(id);

		for (const [column, { relationName, targetResource }] of Array.from(
			relationalColumns(this.schema, resource),
		)) {
			const targetId = row[column];
			if (!targetId) continue;
			this.link(
				id,
				targetId,
				relationName,
				inverseRelationName(this.schema, resource, targetResource, relationName),
			);
		}

		this.ingestNested(resource, id, row);
	}

	/** Recurse through a row's nested relations, wiring edges for the subtree. */
	private ingestNested(resource: string, id: string, data: any): void {
		const relations = this.schema[resource]?.relations;
		if (!relations) return;

		for (const [relationName, relation] of Object.entries(relations)) {
			const nested = data[relationName];
			if (!nested) continue;

			const targetResource = relation.entity.name;

			if (relation.type === 'one') {
				if (typeof nested === 'object' && nested.id) {
					this.link(
						id,
						nested.id,
						relationName,
						inverseRelationName(
							this.schema,
							resource,
							targetResource,
							relationName,
						),
					);
					this.ingestNested(targetResource, nested.id, nested);
				}
			} else if (relation.type === 'many' && Array.isArray(nested)) {
				// The edge is stored on the child pointing back at the parent, so wire
				// the reverse (child → parent) using the child-side inverse relation.
				const reverseInverse = inverseRelationName(
					this.schema,
					targetResource,
					resource,
					relationName,
				);
				for (const item of nested) {
					if (item && typeof item === 'object' && item.id) {
						this.ensureNode(item.id);
						if (reverseInverse)
							this.link(item.id, id, reverseInverse, relationName);
						this.ingestNested(targetResource, item.id, item);
					}
				}
			}
		}
	}

	/**
	 * Apply a committed write's effect on `id`'s outgoing FK edges. With no
	 * `payload` (an INSERT) every present FK column is wired; with a `payload` (an
	 * UPDATE) only the columns it touches are diffed — a reassigned FK unlinks the
	 * old target and links the new one, an FK set to `null`/absent just unlinks.
	 */
	applyWrite(
		resource: string,
		id: string,
		value: any,
		payload?: Record<string, any>,
	): void {
		this.ensureNode(id);

		for (const [column, { relationName, targetResource }] of Array.from(
			relationalColumns(this.schema, resource),
		)) {
			if (payload && !(column in payload)) continue;

			const inverse = inverseRelationName(
				this.schema,
				resource,
				targetResource,
				relationName,
			);
			const previous = this.nodes.get(id)?.references.get(relationName);
			const next = value?.[column];
			if (previous === next) continue;

			if (previous) this.unlink(id, previous, relationName, inverse);
			if (next) this.link(id, next, relationName, inverse);
		}
	}

	/** Mark `id` as matching a query (creating the node if needed). */
	setMatched(id: string, queryHash: string): void {
		this.ensureNode(id).matchedQueries.add(queryHash);
	}

	/** Clear a query match from `id`. */
	clearMatched(id: string, queryHash: string): void {
		this.nodes.get(id)?.matchedQueries.delete(queryHash);
	}

	/** Whether `id` currently matches the given query. */
	matches(id: string, queryHash: string): boolean {
		return this.nodes.get(id)?.matchedQueries.has(queryHash) ?? false;
	}

	/** The set of query hashes `id` currently matches (live view; copy to retain). */
	matchedQueriesOf(id: string): ReadonlySet<string> {
		return this.nodes.get(id)?.matchedQueries ?? EMPTY;
	}

	/**
	 * The id `childId` points at via the parent-side relation `parentRelation`
	 * (declared on `parentResource`) — i.e. follow the child's FK up to its parent.
	 * The inverse relation is resolved internally.
	 */
	reference(
		childId: string,
		parentResource: string,
		parentRelation: string,
	): string | undefined {
		const relation = this.schema[parentResource]?.relations?.[parentRelation];
		if (!relation) return undefined;
		const inverse = inverseRelationName(
			this.schema,
			parentResource,
			relation.entity.name,
			parentRelation,
		);
		if (!inverse) return undefined;
		return this.nodes.get(childId)?.references.get(inverse);
	}

	/**
	 * The ids that reference `relatedId` through `relation` (declared on
	 * `fromResource`) — i.e. the rows whose `relation` FK points at `relatedId`.
	 * Drives the reverse-ref fan-out; the inverse relation is resolved internally.
	 */
	referencedBy(
		relatedId: string,
		fromResource: string,
		relation: string,
	): ReadonlySet<string> {
		const rel = this.schema[fromResource]?.relations?.[relation];
		if (!rel) return EMPTY;
		const inverse = inverseRelationName(
			this.schema,
			fromResource,
			rel.entity.name,
			relation,
		);
		if (!inverse) return EMPTY;
		return this.nodes.get(relatedId)?.referencedBy.get(inverse) ?? EMPTY;
	}

	/** Whether the graph is tracking `id` at all. */
	has(id: string): boolean {
		return this.nodes.has(id);
	}
}
