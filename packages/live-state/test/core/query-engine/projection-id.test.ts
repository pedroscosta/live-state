import { describe, expect, test } from 'vitest';
import type { QueryStep } from '../../../src/core/query-engine/types';
import {
	canonicalHash,
	projectionIdFor,
	stepNodeKey,
} from '../../../src/core/query-engine/utils';

const root = (query: Partial<QueryStep['query']> = {}): QueryStep => ({
	query: { resource: 'posts', ...query },
	stepPath: [],
});

const child = (
	path: string[],
	query: Partial<QueryStep['query']> = {},
): QueryStep => ({
	query: { resource: 'users', ...query },
	stepPath: path,
});

describe('canonicalHash', () => {
	test('ignores object key order at every depth', () => {
		expect(canonicalHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
			canonicalHash({ b: { d: 3, c: 2 }, a: 1 }),
		);
	});

	test('keeps array order', () => {
		expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
	});

	test('serializes dates by value', () => {
		expect(canonicalHash({ at: new Date(0) })).toBe(
			canonicalHash({ at: new Date(0) }),
		);
		expect(canonicalHash({ at: new Date(0) })).not.toBe(
			canonicalHash({ at: new Date(1) }),
		);
	});
});

describe('projectionIdFor', () => {
	const base = () => [root({ where: { status: 'a' } }), child(['author'])];

	test('is stable across step and key order', () => {
		expect(
			projectionIdFor([
				root({ where: { status: 'a', rank: 1 } }),
				child(['author']),
				child(['comments'], { resource: 'comments' }),
			]),
		).toBe(
			projectionIdFor([
				child(['comments'], { resource: 'comments' }),
				child(['author']),
				root({ where: { rank: 1, status: 'a' } }),
			]),
		);
	});

	test.each([
		['root limit', [root({ where: { status: 'a' }, limit: 10 }), child(['author'])]],
		[
			'root sort',
			[
				root({ where: { status: 'a' }, sort: [{ key: 'rank', direction: 'asc' }] }),
				child(['author']),
			],
		],
		['root where', [root({ where: { status: 'b' } }), child(['author'])]],
		['include where', [root({ where: { status: 'a' } }), child(['author'], { where: { x: 1 } })]],
		['include limit', [root({ where: { status: 'a' } }), child(['author'], { limit: 1 })]],
		['include path', [root({ where: { status: 'a' } }), child(['editor'])]],
		['missing include', [root({ where: { status: 'a' } })]],
	])('changes with %s', (_name, steps) => {
		expect(projectionIdFor(steps)).not.toBe(projectionIdFor(base()));
	});
});

describe('stepNodeKey', () => {
	test('separates projections and paths', () => {
		expect(stepNodeKey('p1', ['author'])).not.toBe(stepNodeKey('p2', ['author']));
		expect(stepNodeKey('p1', [])).not.toBe(stepNodeKey('p1', ['author']));
		expect(stepNodeKey('p1', ['a', 'b'])).not.toBe(stepNodeKey('p1', ['a']));
	});
});
