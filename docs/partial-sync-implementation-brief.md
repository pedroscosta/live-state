# Partial sync: implementation brief

A short version of `docs/partial-sync-frontier.md` for planning the implementation.
The rationale and rejected alternatives live in that document. Ignore ADR-0004,
ADR-0005, and `docs/incremental-sync-design-notes.md`; they are deprecated.

## Goal

When a client reconnects to a subscribed query, it ends up with exactly the rows
a fresh fetch would return, across the whole result tree (root rows and included
rows). The server sends only what changed and performs no collection read at
reconnect.

## Scope

In: one server process, WebSocket transport, subscribed tracked queries
(including windowed roots and windowed includes).

Out (do not build): multiple server processes, log compaction, a durable log
storage format beyond what a first version needs, the shared entity log
("alternative C"), deduplicating replays across a client's queries, and any
handling of authorization changes while offline (still being designed).

## Concepts

- **Source position:** a strictly increasing number assigned to each committed
  source transaction, server-wide.
- **Projection:** the query engine's existing query node for a canonical query.
  Its identity must include the query's authorization scope. It holds the
  window(s), a reference count per included `(resource, id)`, `throughPosition`,
  and a lease `retainUntil`.
- **Query window log:** per projection, an append-only list of deltas.
- **Cursor:** per client per query, the source position the client has applied
  through.

## Delta

One per source transaction that changes the query's result; none otherwise.

```ts
type RowRef = { resource: string; id: string }

type QueryWindowDelta = {
	queryId: string
	sourcePosition: number
	added:   Array<RowRef & { row: FullRow }>  // full row
	removed: RowRef[]
	updated: Array<RowRef & { patch: Patch }>  // changed fields only
}
```

Per touched `(resource, id)`, compare membership before and after:
out→out nothing; out→in `added`; in→out `removed`; in→in `updated`.
A root row is "in" when it is in its window. An included row is "in" while its
reference count is above 0. Replacement is a removal plus an addition.

A row entering the result brings its whole subtree. Rows in that subtree whose
count goes 0→1 go into `added`; the rest only increment their count. Leaving
mirrors this: rows whose count reaches 0 go into `removed`.

## Server behavior

**Processing a source position** (the engine already does the window work; this
collects its output):

1. Run window maintenance, including boundary reads, against database state at
   that position.
2. Collect `added` / `removed` / `updated` across the tree into one delta.
3. Commit together: new windows and counts, the appended delta, `throughPosition`.
4. Publish the delta to attached subscriptions.

A failure before step 3 leaves the projection at the previous position for retry.
Do not append one log record per engine callback.

**Lifetime:** on socket close, detach delivery but keep the projection
processing and logging until `retainUntil`. Clients on the same canonical query
share one projection and log.

**Subscribe / resume handoff**, per client subscription:

1. Attach the subscription in a buffering state (deltas held, not sent).
2. Read the log after the client's position, or take the snapshot for a first
   subscribe. Let `R` be `throughPosition` at that read.
3. Send the replay (or snapshot) with `throughPosition: R`.
4. Send held deltas with `sourcePosition > R`, in order; drop the rest.
5. Switch to live delivery.

No `await` between steps 3 and 5.

## Protocol

- First subscribe → snapshot + `throughPosition`.
- Resume `{ queryId, afterPosition }` → deltas after it + `throughPosition`
  (which advances even if no delta touched the query).
- Lease expired or log doesn't cover `afterPosition` → `CURSOR_EXPIRED`; the
  client takes a fresh snapshot.

## Client behavior

- Store rows normalized by `(resource, id)` and a cursor per query.
- Apply each delta and persist the cursor in one IndexedDB transaction.
- Removing a row from one query must not delete it while another query holds it.
  The retention rule across queries is not yet designed; keep it conservative.

## Invariants to test

- After resuming at any position within the lease, the client's rows equal a
  fresh fetch, including included rows.
- A client receives every delta after its position exactly once, in order,
  including deltas published during the handoff.
- A window never appears short to a client because a removal and its
  replacement were split across deltas.
- A row entering by any path (insert, update scope-in, eviction backfill,
  promotion) arrives with its full subtree.
- Reconnect issues no collection read.

## Known code facts and gaps

- Engine: `packages/live-state/src/core/query-engine/index.ts`.
  - Query nodes are deleted when their last subscriber leaves (around line 515).
    The lease changes this.
  - `sendFullInsertTree` (around line 1621) already loads a row with its
    includes on insert.
  - **Bug:** `backfillWindow` (around line 1384) reads with only the sort
    include and emits a bare row, so backfilled rows arrive without their
    includes. Fix by reading with the child-query include merged with the sort
    include, then emitting through the same tree path. Existing tests in
    `test/e2e/windowed-includes.test.ts` don't cover this.
  - Scope-out currently emits a `DELETE` delta with no query identity.
- WebSocket transport: `packages/live-state/src/server/transport-layers/web-socket.ts`.
  The subscribe handler awaits `handleCustomQuery` and drops empty-payload
  deltas (scope-outs).
- Client reconnect re-subscribes and reloads the full result:
  `packages/live-state/src/client/websocket/client.ts`.
