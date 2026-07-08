/** biome-ignore-all lint/suspicious/noExplicitAny: schema relations are dynamically shaped */

import type { Schema } from '../../schema';

/**
 * The relational (foreign-key) columns declared on a resource: each maps a local
 * column (e.g. `authorId`) to the relation it backs and the resource it targets.
 * Only `one` relations carry a `relationalColumn` on the source entity, so only
 * those appear here. Pure schema query — shared by the {@link RelationGraph}
 * (edge wiring) and the query engine's relational-sort logic.
 */
export function relationalColumns(
	schema: Schema<any>,
	resourceName: string,
): Map<string, { relationName: string; targetResource: string }> {
	const result = new Map<
		string,
		{ relationName: string; targetResource: string }
	>();
	const resourceSchema = schema[resourceName];

	if (!resourceSchema?.relations) return result;

	for (const [relationName, relation] of Object.entries(
		resourceSchema.relations,
	)) {
		if (relation.type === 'one' && relation.relationalColumn) {
			result.set(String(relation.relationalColumn), {
				relationName,
				targetResource: relation.entity.name,
			});
		}
	}

	return result;
}

/**
 * The name of the relation on `targetResource` that is the inverse of
 * `relationName` on `sourceResource` — the other side of the same edge. A `many`
 * relation's inverse is the `one` relation on the target whose `relationalColumn`
 * matches the `many`'s `foreignColumn`, and vice versa. Pure schema query;
 * `undefined` when no inverse is declared.
 */
export function inverseRelationName(
	schema: Schema<any>,
	sourceResource: string,
	targetResource: string,
	relationName: string,
): string | undefined {
	const sourceSchema = schema[sourceResource];
	if (!sourceSchema?.relations) return undefined;

	const sourceRelation = sourceSchema.relations[relationName];
	if (!sourceRelation) return undefined;

	const targetSchema = schema[targetResource];
	if (!targetSchema?.relations) return undefined;

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
