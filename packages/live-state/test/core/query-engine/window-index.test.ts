import { describe, expect, test } from "vitest";
import {
	type OrderBy,
	WindowIndex,
} from "../../../src/core/query-engine/window-index";

/** Build an index and bulk-insert entries, returning the index. */
function buildIndex(
	opts: { limit: number; orderBy?: OrderBy },
	entries: { id: string; sortKey: (string | number | boolean | null)[] }[] = [],
) {
	const index = new WindowIndex(opts);
	for (const e of entries) index.insert(e);
	return index;
}

describe("WindowIndex", () => {
	describe("ordering", () => {
		test("a bare limit with no orderBy orders by id", () => {
			const index = buildIndex({ limit: 5 }, [
				{ id: "c", sortKey: [] },
				{ id: "a", sortKey: [] },
				{ id: "b", sortKey: [] },
			]);
			expect(index.ids()).toEqual(["a", "b", "c"]);
		});

		test("orders by a single ascending key", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 5, orderBy }, [
				{ id: "x", sortKey: [30] },
				{ id: "y", sortKey: [10] },
				{ id: "z", sortKey: [20] },
			]);
			expect(index.ids()).toEqual(["y", "z", "x"]);
		});

		test("orders by a single descending key", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "desc" }];
			const index = buildIndex({ limit: 5, orderBy }, [
				{ id: "x", sortKey: [30] },
				{ id: "y", sortKey: [10] },
				{ id: "z", sortKey: [20] },
			]);
			expect(index.ids()).toEqual(["x", "z", "y"]);
		});

		test("breaks ties on equal sort values using id (ascending)", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "desc" }];
			const index = buildIndex({ limit: 5, orderBy }, [
				{ id: "b", sortKey: [10] },
				{ id: "a", sortKey: [10] },
				{ id: "c", sortKey: [10] },
			]);
			// id tiebreaker stays ascending even when the key is descending
			expect(index.ids()).toEqual(["a", "b", "c"]);
		});

		test("composite keys with mixed asc/desc compare correctly", () => {
			const orderBy: OrderBy = [
				{ key: "status", direction: "asc" },
				{ key: "score", direction: "desc" },
			];
			const index = buildIndex({ limit: 10, orderBy }, [
				{ id: "1", sortKey: ["open", 5] },
				{ id: "2", sortKey: ["open", 9] },
				{ id: "3", sortKey: ["closed", 1] },
				{ id: "4", sortKey: ["closed", 8] },
			]);
			// status asc: closed before open; within each, score desc
			expect(index.ids()).toEqual(["4", "3", "2", "1"]);
		});

		test("null/undefined sort before concrete values (ascending)", () => {
			const orderBy: OrderBy = [{ key: "name", direction: "asc" }];
			const index = buildIndex({ limit: 10, orderBy }, [
				{ id: "1", sortKey: ["b"] },
				{ id: "2", sortKey: [null] },
				{ id: "3", sortKey: ["a"] },
				{ id: "4", sortKey: [undefined] },
			]);
			// null/undefined first (id tiebreaker asc), then concrete values asc
			expect(index.ids()).toEqual(["2", "4", "3", "1"]);
		});

		test("position reflects sorted order and is undefined for absent ids", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 5, orderBy }, [
				{ id: "x", sortKey: [30] },
				{ id: "y", sortKey: [10] },
				{ id: "z", sortKey: [20] },
			]);
			expect(index.position("y")).toBe(0);
			expect(index.position("z")).toBe(1);
			expect(index.position("x")).toBe(2);
			expect(index.position("missing")).toBeUndefined();
			expect(index.has("missing")).toBe(false);
		});
	});

	describe("insert and eviction", () => {
		test("inserts without eviction while the window has room", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = new WindowIndex({ limit: 3, orderBy });
			expect(index.insert({ id: "a", sortKey: [10] })).toEqual({
				inserted: true,
			});
			expect(index.insert({ id: "b", sortKey: [20] })).toEqual({
				inserted: true,
			});
			expect(index.isFull).toBe(false);
			expect(index.size).toBe(2);
		});

		test("evicts the boundary when a new row sorts into a full window", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 3, orderBy }, [
				{ id: "a", sortKey: [10] },
				{ id: "b", sortKey: [20] },
				{ id: "c", sortKey: [30] },
			]);
			expect(index.isFull).toBe(true);

			const result = index.insert({ id: "d", sortKey: [15] });
			expect(result.inserted).toBe(true);
			expect(result.evicted).toEqual({ id: "c", sortKey: [30] });
			expect(index.ids()).toEqual(["a", "d", "b"]);
			expect(index.has("c")).toBe(false);
		});

		test("rejects a row that sorts at/after the boundary of a full window", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 3, orderBy }, [
				{ id: "a", sortKey: [10] },
				{ id: "b", sortKey: [20] },
				{ id: "c", sortKey: [30] },
			]);
			const result = index.insert({ id: "d", sortKey: [40] });
			expect(result).toEqual({ inserted: false });
			expect(index.ids()).toEqual(["a", "b", "c"]);
		});

		test("a limit-0 window accepts nothing", () => {
			const index = new WindowIndex({ limit: 0 });
			expect(index.insert({ id: "a", sortKey: [] })).toEqual({
				inserted: false,
			});
			expect(index.size).toBe(0);
		});

		test("inserting a duplicate id throws", () => {
			const index = buildIndex({ limit: 5 }, [{ id: "a", sortKey: [] }]);
			expect(() => index.insert({ id: "a", sortKey: [] })).toThrow();
		});
	});

	describe("boundary and needs-backfill", () => {
		test("boundary is the Nth (last) entry, undefined when empty", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = new WindowIndex({ limit: 3, orderBy });
			expect(index.boundary()).toBeUndefined();
			index.insert({ id: "a", sortKey: [10] });
			index.insert({ id: "b", sortKey: [20] });
			expect(index.boundary()).toEqual({ id: "b", sortKey: [20] });
		});

		test("a full window does not need backfill", () => {
			const index = buildIndex({ limit: 2 }, [
				{ id: "a", sortKey: [] },
				{ id: "b", sortKey: [] },
			]);
			expect(index.isFull).toBe(true);
			expect(index.needsBackfill()).toBe(false);
			expect(index.backfillCount).toBe(0);
		});

		test("removing a visible row from a full window signals backfill", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 3, orderBy }, [
				{ id: "a", sortKey: [10] },
				{ id: "b", sortKey: [20] },
				{ id: "c", sortKey: [30] },
			]);
			const removed = index.remove("b");
			expect(removed).toEqual({ id: "b", sortKey: [20] });
			expect(index.ids()).toEqual(["a", "c"]);
			expect(index.needsBackfill()).toBe(true);
			expect(index.backfillCount).toBe(1);
			expect(index.boundary()).toEqual({ id: "c", sortKey: [30] });
		});

		test("eviction keeps the window full (no backfill needed)", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 3, orderBy }, [
				{ id: "a", sortKey: [10] },
				{ id: "b", sortKey: [20] },
				{ id: "c", sortKey: [30] },
			]);
			index.insert({ id: "d", sortKey: [5] });
			expect(index.isFull).toBe(true);
			expect(index.needsBackfill()).toBe(false);
		});

		test("removing an absent id is a no-op", () => {
			const index = buildIndex({ limit: 3 }, [{ id: "a", sortKey: [] }]);
			expect(index.remove("nope")).toBeUndefined();
			expect(index.size).toBe(1);
		});
	});

	describe("snapshot", () => {
		test("snapshot returns a defensive copy", () => {
			const orderBy: OrderBy = [{ key: "age", direction: "asc" }];
			const index = buildIndex({ limit: 3, orderBy }, [
				{ id: "a", sortKey: [10] },
			]);
			const snap = index.snapshot();
			snap[0].sortKey[0] = 999;
			expect(index.snapshot()).toEqual([{ id: "a", sortKey: [10] }]);
		});
	});
});
