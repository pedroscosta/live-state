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

/**
 * A hash that ignores object key order, so equal queries hash equally. It is
 * 64 bits wide (two seeded xxHash32 passes) because a collision silently merges
 * two projections; 32 bits gets likely at tens of thousands of live queries.
 */
export function canonicalHash(value: unknown): string {
	const json = JSON.stringify(value, sortKeys) ?? 'undefined';
	return (
		xxHash32(json, 0).toString(36).padStart(7, '0') +
		xxHash32(json, 0x9e3779b9).toString(36).padStart(7, '0')
	);
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
				// `{}` and `[]` mean the same as absent; keep them from splitting a projection.
				where:
					step.query.where && Object.keys(step.query.where).length > 0
						? step.query.where
						: undefined,
				limit: step.query.limit,
				sort: step.query.sort?.length ? step.query.sort : undefined,
			}))
			.sort((a, b) => {
				const pa = JSON.stringify(a.path);
				const pb = JSON.stringify(b.path);
				return pa < pb ? -1 : pa > pb ? 1 : 0;
			}),
	);
}

// Paths are encoded structurally: relation names may contain any character,
// so a delimiter join could make `['a.b']` and `['a', 'b']` collide.
export function stepNodeKey(projectionId: string, stepPath: string[]): string {
	return `${projectionId}:${JSON.stringify(stepPath)}`;
}
