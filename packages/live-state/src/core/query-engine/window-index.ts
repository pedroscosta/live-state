/**
 * In-memory ordering index for a single windowed scope (a Tracked Query or
 * windowed `include` that declares a `limit`). Per ADR-0003 it holds **only**
 * `{ id, sortKey }` for the `N` visible rows — no overscan buffer, no row
 * payloads.
 *
 * The total order is always `[...orderBy, id]`: the `id` is appended as a
 * deterministic tiebreaker so the window boundary (and any future cursor) is
 * unambiguous. A bare `limit` with no `orderBy` therefore orders by `id` alone.
 *
 * This module is the matching/broadcasting half of the engine's window logic,
 * extracted so it can be unit-tested in isolation. It exposes just enough for
 * the engine to drive membership-only broadcasts without a database read in the
 * common cases: insert a row, remove a row, look up a row's position, read the
 * current boundary, and report whether a shrink left the window under-full.
 */

export type SortDirection = 'asc' | 'desc';

export type OrderBy = { key: string; direction: SortDirection }[];

/** A single comparable cell of a sort key. */
export type SortValue = string | number | boolean | null | undefined;

/**
 * The ordered tuple of `orderBy` values for a row, in the same order as the
 * index's `orderBy`. The `id` tiebreaker is appended by the index itself and
 * must **not** be included here.
 */
export type SortKey = SortValue[];

export interface WindowEntry {
	id: string;
	sortKey: SortKey;
}

export interface InsertResult {
	/** Whether the row ended up inside the window. */
	inserted: boolean;
	/**
	 * The entry displaced because the window was full and the new row sorted
	 * ahead of the previous boundary. Present only on an eviction; the engine
	 * broadcasts this as a scope-out (`DELETE`) without a database read.
	 */
	evicted?: WindowEntry;
}

/**
 * Compare two sort cells in ascending order. `null`/`undefined` sort before any
 * concrete value (matching SQLite's `NULLS FIRST` for ascending); booleans
 * compare as `false < true`.
 */
function compareValues(a: SortValue, b: SortValue): number {
	const aNil = a === null || a === undefined;
	const bNil = b === null || b === undefined;
	if (aNil && bNil) return 0;
	if (aNil) return -1;
	if (bNil) return 1;

	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean')
		return Number(a) - Number(b);

	const as = String(a);
	const bs = String(b);
	if (as < bs) return -1;
	if (as > bs) return 1;
	return 0;
}

export class WindowIndex {
	private readonly limit: number;
	private readonly directions: SortDirection[];
	/** Entries sorted by the total order `[...orderBy, id]`, capped at `limit`. */
	private entries: WindowEntry[] = [];
	private readonly index: Map<string, WindowEntry> = new Map();

	constructor(opts: { limit: number; orderBy?: OrderBy }) {
		if (!Number.isInteger(opts.limit) || opts.limit < 0)
			throw new Error('WindowIndex limit must be a non-negative integer');
		this.limit = opts.limit;
		this.directions = (opts.orderBy ?? []).map((o) => o.direction);
	}

	/** Number of rows currently held in the window. */
	get size(): number {
		return this.entries.length;
	}

	/** Whether the window currently holds its full `N` rows. */
	get isFull(): boolean {
		return this.entries.length >= this.limit;
	}

	/**
	 * Compare two entries by the total order `[...orderBy, id]`. `id` is always
	 * an ascending tiebreaker regardless of `orderBy` directions.
	 */
	private compare(a: WindowEntry, b: WindowEntry): number {
		for (let i = 0; i < this.directions.length; i++) {
			const cmp = compareValues(a.sortKey[i], b.sortKey[i]);
			if (cmp !== 0) return this.directions[i] === 'desc' ? -cmp : cmp;
		}
		if (a.id < b.id) return -1;
		if (a.id > b.id) return 1;
		return 0;
	}

	/**
	 * Binary search for the position at which `entry` sorts. Returns the index of
	 * the first element that is **not** ordered before `entry` (lower bound).
	 */
	private lowerBound(entry: WindowEntry): number {
		let lo = 0;
		let hi = this.entries.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (this.compare(this.entries[mid], entry) < 0) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	/**
	 * Insert a row into the window. If the window is full and the row sorts ahead
	 * of the current boundary, the boundary entry is evicted and returned; if the
	 * window is full and the row sorts at/after the boundary, it is rejected
	 * (`inserted: false`).
	 */
	insert(entry: WindowEntry): InsertResult {
		if (this.limit === 0) return { inserted: false };
		if (this.index.has(entry.id))
			throw new Error(`WindowIndex already contains id "${entry.id}"`);

		const pos = this.lowerBound(entry);

		if (this.isFull && pos >= this.limit) return { inserted: false };

		this.entries.splice(pos, 0, entry);
		this.index.set(entry.id, entry);

		if (this.entries.length > this.limit) {
			const evicted = this.entries.pop();
			if (evicted) {
				this.index.delete(evicted.id);
				return { inserted: true, evicted };
			}
		}

		return { inserted: true };
	}

	/** Remove a row from the window. Returns the removed entry, if present. */
	remove(id: string): WindowEntry | undefined {
		const entry = this.index.get(id);
		if (!entry) return undefined;
		const pos = this.lowerBound(entry);
		// `lowerBound` lands on the first entry not ordered before `entry`; with a
		// unique id tiebreaker that is exactly this entry.
		this.entries.splice(pos, 1);
		this.index.delete(id);
		return entry;
	}

	/** Whether the given id is currently in the window. */
	has(id: string): boolean {
		return this.index.has(id);
	}

	/** Zero-based position of a row in the current order, or `undefined`. */
	position(id: string): number | undefined {
		const entry = this.index.get(id);
		if (!entry) return undefined;
		return this.lowerBound(entry);
	}

	/**
	 * The current window boundary: the last (`N`th) entry in order. The engine
	 * uses this as the cursor for a boundary read when backfilling.
	 */
	boundary(): WindowEntry | undefined {
		return this.entries[this.entries.length - 1];
	}

	/**
	 * Whether the window is under-full and therefore may need a backfill read.
	 * True after a shrink left fewer than `N` rows; the engine decides whether
	 * rows actually exist past the boundary.
	 */
	needsBackfill(): boolean {
		return this.entries.length < this.limit;
	}

	/** How many rows would be needed to refill the window to `N`. */
	get backfillCount(): number {
		return Math.max(0, this.limit - this.entries.length);
	}

	/** A snapshot of the current ordering (defensive copy). */
	snapshot(): WindowEntry[] {
		return this.entries.map((e) => ({ id: e.id, sortKey: [...e.sortKey] }));
	}

	/** The current ordered list of ids. */
	ids(): string[] {
		return this.entries.map((e) => e.id);
	}
}
