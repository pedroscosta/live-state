# Partial sync: design frontier

Status: in progress. Rounds 1–7 accepted. Next design hole: authorization scope changes while offline.

Concise implementation brief: `docs/partial-sync-implementation-brief.md`.

This note replaces the earlier partial-sync material (ADR-0004, ADR-0005,
`docs/incremental-sync-design-notes.md`, and the partial-sync items in
`1-0-checklist.md`), which predate this design and are deprecated.

## Goals

- Reduce database load and reconnect latency, especially for short disconnects.
- "Partial" has two meanings:
  1. **A window of a collection** (for example the first 1k of 10k) that stays
     correct across going offline and coming back. This is the critical one.
  2. **Only what changed** on rows the client already holds.
- The server is stateful. The design is not limited to stateless, client-held
  cursors.

## Frontier

### Guarantee

After a client replays a query's log from its cursor, it holds exactly the rows a
fresh execution of that query would return, across every resource in the
query's result tree. Reconnect performs no collection read.

### State

**Logical sync log (server).** Every committed source transaction has a strictly
increasing source position.

**Query projection (server)**, one per canonical query. The engine's existing
query node is the projection.

```ts
{
	queryId          // canonical query identity, including authorization scope
	window           // ordered member ids per windowed step (root and windowed includes)
	refCounts        // per (resource, id): in-result parents referencing an included row
	throughPosition  // last source position fully processed
	retainUntil      // lease; outlives sockets
}
```

**Query window log (server)**, one per projection. Each source transaction that
changes the result produces at most one atomic delta:

```ts
type RowRef = { resource: string; id: string }

type QueryWindowDelta = {
	queryId: string
	sourcePosition: number
	added:   Array<RowRef & { row: FullRow }>
	removed: RowRef[]
	updated: Array<RowRef & { patch: Patch }>
}
```

**Client**, per query: its rows in a normalized store keyed by `(resource, id)`,
plus a cursor (the source position it has applied through).

### Classification

For each `(resource, id)` a source transaction touches, compare membership in the
query's result before and after:

| Before → After | Output |
|---|---|
| out → out | nothing |
| out → in | `added` with the full row |
| in → out | `removed` |
| in → in | `updated` with changed fields only |

A root row is "in" when it is in its window. An included row is "in" while at
least one in-result parent references it (reference count > 0). Replacement is a
removal plus an addition; there is no `REPLACED` op.

Patch rule: applying the patch to the row as of the previous delta gives the
row's value at `sourcePosition`. The encoding is undefined.

### Projection

The existing query engine (`packages/live-state/src/core/query-engine/index.ts`)
is the projector. It already maintains windows, detects exits, runs the boundary
read for backfill, and emits field updates. For each source position, its output
is collected into one delta and persisted, rather than logging each callback.

Per source position:

1. Run all window maintenance, including any boundary reads, against database
   state at that position (or a later position, with the delta labelled with that
   later position).
2. Collect `added` / `removed` / `updated` across the whole result tree.
3. Commit atomically: the new window and reference counts, the appended delta,
   and `throughPosition`.
4. Publish the delta to attached subscriptions.

If anything fails before step 3, the projection stays at the previous position and
retries.

### Protocol

- **First subscribe:** the snapshot plus the source position it reflects.
- **Resume:** the client sends `{ queryId, afterPosition }`. The server replies
  with the deltas after it and `throughPosition`. Positions that don't touch the
  result still advance the cursor.
- **Expired:** if the lease or the log no longer covers `afterPosition`, the
  server replies `CURSOR_EXPIRED` and the client takes a fresh snapshot.
- **Client apply:** apply each delta and persist the cursor in one IndexedDB
  transaction.

### Replay-to-live handoff (server-side)

Each client subscription moves through `buffering → replaying → live`:

1. Attach the subscription in `buffering`. Published deltas are held, not sent.
2. Read the log after `afterPosition`; let `R` be `throughPosition` at the read.
3. Send the replay with `throughPosition: R`.
4. Flush held deltas with `sourcePosition > R` in order; drop the rest.
5. Switch to `live`.

Steps 3–5 run with no `await` between them. First subscribe follows the same
order, with the snapshot in place of the replay. This works because a delta is
appended and published as one step: it is either in the read or in the buffer.

Invariant: a client receives every delta with `sourcePosition > afterPosition`
exactly once, in increasing order.

### Lifetime

Projections outlive sockets under a lease. On disconnect, detach delivery but
keep processing the source log and appending deltas. All clients on the same
canonical query share one projection and one log, each with its own cursor.

### Boundaries (assumed, not solved)

- One server process. Every relevant write reaches the query engine.
- Log storage format, indexing, and compaction are deferred.
- Overlapping queries on the client: whether a row removed from one query is
  deleted from the shared store depends on other queries holding it. Not yet
  designed.
- Authorization changes while offline: not yet examined (next design hole).

### Recorded alternative (not built)

**Shared entity log (C).** Keep `added` / `removed` per query, but move `updated`
into one global per-object log ordered by the same `sourcePosition`. A change to a
popular object costs one append instead of one per distinct query holding it.
Costs: a second stream to merge on reconnect, a per-client filter by held rows at
the cursor point, retention sized to the longest lease, and per-client field-level
auth filtering.

Trigger to build it: frequently written fields on objects held by many distinct
active queries (for example presence or `lastSeenAt` on users included across
many channel queries). Moving to it is mechanical; the client still applies
changes in position order, keyed by `(resource, id)`.

### Deferred optimizations

- Collapsing duplicate `(resource, id, sourcePosition)` patches across one
  client's queries during replay.
- A complete ordered server index to avoid boundary reads.

## Decision trail

### Round 1: latest 100, inserts only

- **Model:** on reconnect, rerun the query and send the latest 100.
- **Hole:** one row inserted while offline; the server reads and sends 100.
- **Options:** rerun; query rows newer than the client's newest; keep the
  subscription alive on the server while the client is away.
- **Chosen:** retain server-side query state across disconnects so reconnect
  needs no DB read.

### Round 2: a logical log plus a client cursor

- **Model:** the user proposed a server log of changes and a client cursor ("the
  last time you served me this query, it was at this point").
- **Finding:** for insert-only it works with zero collection reads, provided the
  snapshot is tagged with an exact position and the log is retained past the
  cursor.
- **Hole:** deletion. Item 150 is deleted from a window of 200…101. The raw log
  entry names item 150 but nothing about item 100, which must enter.
- **Options:** repair on reconnect with a query; send overflow rows to the client
  (only delays the failure); maintain the query result on the server and log its
  changes.
- **Chosen:** a server-side query projection and a derived per-query log.

### Round 3: the query window log

- **Model:** the user proposed logging what happened to the window itself.
- **Chosen:** one atomic delta per source transaction,
  `{ queryId, sourcePosition, added, removed }`. Replacement is removal plus
  addition. Separate enter/leave records were rejected: a crash between them
  persists a 99-row window.
- **Guarantee at this point:** same set of ids as a fresh fetch.

### Round 4: finding the replacement

- **Hole:** the projector knows item 150 left but holds nothing outside the
  window to replace it with.
- **Options:** lookahead buffer (delays the failure); full ordered server index
  (heavy); targeted boundary read when a vacancy appears.
- **Correction:** the existing query engine already does the boundary read and
  backfill. It is the projector; its output for each source position is collected
  into one delta and persisted, not logged per callback.

### Round 4b: projection lifetime

- **Hole:** today the engine deletes a query node when its last subscriber
  disconnects, so nothing computes deltas while the client is offline.
- **Chosen:** projections live under a lease (`retainUntil`); expiry returns
  `CURSOR_EXPIRED` and a fresh snapshot. Clients on the same query share one log.

### Round 5: updates inside the window

- **Hole:** item 150's title changes while it stays in the window; membership is
  unchanged, so nothing is logged and the client keeps a stale title.
- **Options:** resend full rows; field patches in the same delta; a separate
  entity log (second cursor, ordering problem).
- **Chosen:** `updated: { id, patch }[]` in the same delta, with the
  out/in classification table.
- **Guarantee at this point:** same rows as a fresh fetch, for flat queries.

### Round 6: replay-to-live handoff

- **Hole:** reading the log is async. A delta published between the read and
  attaching live delivery reaches nobody, and because no-op positions produce no
  delta, the client can't detect the gap. Attaching first without dedupe can
  duplicate or misorder deltas instead.
- **Options:** attach first, buffer, dedupe on the server; link each delta to the
  previous one so the client detects gaps; a per-query lock across read and attach.
- **Chosen:** server-side buffer and dedupe. No protocol change. The client-side
  variant was considered equivalent; the server is preferred so every client gets
  it without re-implementing the merge.

### Round 7: included relations

- **Hole:** `posts.include({ author })`. A user rename touches only `users`, so the
  posts log records nothing. Repointing a post to an unseen user adds a dangling
  reference.
- **Options:**
  - A: one tree log per query, rows keyed by `(resource, id)`.
  - B: one log per include step (one cursor each; cross-log atomicity; same write
    cost as A; not shareable).
  - C: per-query membership plus a shared entity log for field changes.
- **Comparison:** within one query a row is one entry however many times it
  appears, so A's cost scales with distinct queries holding the row, not with
  references. For a Linear-like app (one large shared org query plus a few views),
  personal data, and storefronts, A wins. C wins only for hot fields on objects
  held by many distinct active queries. A projection's identity must include its
  authorization scope, which decides whether "one big query" is really shared.
- **Chosen:** A, without replay collapsing. C recorded as a viable alternative,
  not built. B dropped.
- **Consequence (invariant, not a separate round):** any row entering the result
  brings its subtree, and reference counts decide which of those rows go into
  `added`. Every entry path (insert, update scope-in, eviction backfill,
  promotion) must satisfy it.
- **Known engine gap:** `backfillWindow` reads with only the sort include and
  emits a bare row, so a backfilled row arrives without its includes (for
  example a backfilled comment whose author is nowhere else in the result). This
  is a bug in today's live path, tracked as implementation work, not design.
