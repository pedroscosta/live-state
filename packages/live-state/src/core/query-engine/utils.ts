import { xxHash32 } from 'js-xxhash';
import type { QueryStep } from './types';

// The replacer sees values after `toJSON`, so dates arrive as strings and only
// plain objects get their keys reordered.
const sortKeys = (_key: string, value: unknown) =>
	value && typeof value === 'object' && !Array.isArray(value)
		? Object.fromEntries(
				Object.keys(value)
					.sort()
					.map((k) => [k, (value as Record<string, unknown>)[k]]),
			)
		: value;

/** A hash that ignores object key order, so equal queries hash equally. */
export function canonicalHash(value: unknown): string {
	return xxHash32(JSON.stringify(value, sortKeys) ?? 'undefined').toString(32);
}

/**
 * The projection id of a decomposed query (ADR-0006 §1): every step's
 * resource, `where`, `limit`, and `sort`, positioned by its path. Steps are
 * ordered by path so include declaration order does not change the id.
 */
export function projectionIdFor(steps: QueryStep[]): string {
	return canonicalHash(
		steps
			.map((step) => ({
				path: step.stepPath,
				resource: step.query.resource,
				where: step.query.where,
				limit: step.query.limit,
				sort: step.query.sort,
			}))
			.sort((a, b) => {
				const pa = a.path.join('.');
				const pb = b.path.join('.');
				return pa < pb ? -1 : pa > pb ? 1 : 0;
			}),
	);
}

/** Key of a projection's step node. Paths are relation names, which cannot contain `.`. */
export function stepNodeKey(projectionId: string, stepPath: string[]): string {
	return `${projectionId}:${stepPath.join('.')}`;
}
