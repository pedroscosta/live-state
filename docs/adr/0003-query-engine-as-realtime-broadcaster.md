---
status: accepted
---

# Query Engine becomes a realtime broadcaster; Storage owns resolution; windows are maintained in-memory

## Context

With the Default Query path and `collectionRoute`/`Route` removed (ADR-0002, #173/#178/#181), the query engine's original reason for existing — sub-dividing a query with `include`s into per-resource sub-queries so each could be run through its collection route — is gone. Storage (`Storage.get` → `applyInclude`) already resolves a full `include` tree (nested `where`/`orderBy`/`limit`, recursive) in a *single* query. So the engine's manual `breakdownQuery`/`resolveQuery`/`resolveStep`/`assembleResults` is redundant *for resolution*.

That leaves the engine with one real job: **matching committed writes against subscribed Tracked Queries and broadcasting Sync Deltas** — keeping each subscribed connection's scope correct in realtime. The hard part of that job is **windows** (a query or `include` with a `limit`): window membership is *relative* to the other rows, and scope changes (evictions, backfills) fire for rows that were never themselves mutated — which the old per-object-boolean matcher could not express.

The design goal stated for the engine: make broadcasting *fast* — neither holding every row in memory, nor hitting the database on every write.

## Decision

**1. Resolution moves to Storage.** Delete `breakdownQuery`/`resolveQuery`/`resolveStep`/`assembleResults`/`loadStepResults`. The engine exposes a thin `resolve(query)` that delegates to a single `storage.get(query)` (includes and all) and *ingests* the nested result into its tracking graph. `QueryStep` loses its resolution fields (`getWhere`/`referenceGetter`/`relationalWhere`/`isMany`).

**2. The engine keeps a lean relationship graph** (`objectNodes` with `referencesObjects`/`referencedByObjects`) for relation-membership matching. It holds **no full rows**.

Structurally, window/ordering logic is extracted into a standalone **`WindowIndex`** module (a sorted `{id, sortKey}` collection per scope, exposing insert/remove/position/boundary/needs-backfill against a clear interface) so it is unit-testable in isolation. `QueryEngine` owns subscriptions + the relationship graph and composes one `WindowIndex` per windowed scope; it stays the matcher/broadcaster.

**3. Windows are maintained in-memory with a window-only ordering index — no buffer, no payloads.**
- An ordering index exists **iff the query/include has a `limit`**. `orderBy` without `limit` needs no window (all matching rows are in scope; the client sorts locally).
- Per windowed scope (per parent, for windowed includes), the engine keeps a **sorted list of `{id, sortKey}` for the `N` visible rows only** — no overscan buffer, no row payloads.
- The total order is always `[...orderBy, id]` (id appended as a tiebreaker for a deterministic boundary/cursor). `limit` with no `orderBy` orders by `id`.
- Broadcasts are **membership-only**: scope-in (`INSERT`, payload from the triggering mutation) and scope-out (`DELETE`, id only). Pure within-window reordering is *not* broadcast — the client re-sorts the `N` rows it holds. Sort keys are maintained incrementally (the new key is in the mutation payload if its field changed, else unchanged).
- `INSERT`/`DELETE` fire only on an actual **entry/exit of a tracked list**, judged per list: was-out→now-in = `INSERT`, was-in→now-out = `DELETE`, was-in→still-in = plain field `UPDATE` (*even if relations changed*), was-out→still-out = nothing. A relation change is never itself the trigger. Re-parenting (e.g. a task moving from project A's window to B's) therefore decomposes into `DELETE` to A's subscribers + `INSERT` to B's only because the two lists differ — only A's side incurs a backfill read; B's `INSERT` payload comes from the task mutation. The same relation change against a root query that still contains the row is a single `UPDATE`.

**4. The single hot-path database read is backfill.** When a window shrinks (a visible row is deleted or updated out of scope), the promoted row was deliberately not kept, so the engine issues a **boundary cursor read** — `where(<query where>) AND sortKey beyond the last remaining visible row, orderBy [...,id], limit = rows needed` — once per write-batch, synchronously, before emitting the backfill `INSERT`s. Evictions need no read (the displaced id is in the index).

**5. Relational `orderBy` (sort key derived from a related object) is supported via reverse-ref fan-out *plus* a boundary cursor read.** On a related-object write that touches a relational sort key: walk `referencedByObjects` to recompute affected in-window rows' sort keys (handles demotions/boundary crossings of *known* rows), **and** issue a boundary cursor read to catch promotions of rows that were outside the window and therefore invisible to the graph.

The notify path already supplies the mutated object's full own-columns (`rawUpdate` passes `rawFindById` as `entityData`), so own-column sort keys and scope-in payloads need no infra change. Relational *where*-matching keeps the existing `storage.get` fallback.

## Considered options

- **Re-resolve + diff** (re-run `storage.get` per affected query per write-batch, diff against last result). Uniform and simplest, handles windows for free — rejected as the default because it puts a database read on *every* write to a subscribed resource, the cost the engine exists to avoid.
- **Overscan buffer (`N+K`) holding full rows.** Makes backfill database-free (amortized) and off the broadcast critical path. Rejected for now: chose no buffer / no payloads to minimize memory and complexity, accepting a synchronous backfill read on window shrink. (This is the natural first optimization if backfill reads become hot.)
- **Window-only index of ids only, with no relationship graph.** Can't evaluate relational where/orderBy — rejected; the graph stays.
- **Restrict `orderBy` to own-columns**, or **accept eventual correctness** for relational sort. Rejected in favor of full correctness via fan-out + boundary read.
- **Keep the incremental graph and bolt ordering/eviction onto it without re-querying.** Impossible for backfill: the promoted row is by definition outside the tracked set, so *some* read is unavoidable.

## Consequences

- The engine no longer resolves queries; a change to `include` resolution semantics is now entirely a Storage concern.
- Backfill is a synchronous database read on the broadcast path (one per write-batch per shrunk window). Relational-`orderBy` writes also incur a boundary cursor read. All other window events (scope-in by own mutation, eviction, within-window reorder) are pure in-memory.
- Memory per windowed scope is bounded to `N` `{id, sortKey}` entries — no payloads, no rows beyond the window.
- This also fixes a pre-existing gap: nested `where` on an `include` is now re-applied for realtime matching (previously child-relation matching checked only relation membership).
- Pagination by `limit + offset` is a degenerate window whose index must span `[0, offset+N)`; deep offsets are O(offset) memory. Cursor pagination collapses back to a bounded window and should be the steered-toward API.
