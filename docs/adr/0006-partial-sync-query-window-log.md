---
status: accepted
---

# Partial sync through per-query projections and a query window log

## Context

On reconnect the client re-subscribes every Remote Query and the server replies with a full
snapshot. Nothing tells the client which rows left a query while it was away, and scope-out
`DELETE`s are dropped by the WebSocket transport. The design that fixes this is in
`docs/partial-sync-frontier.md` (rationale, rejected alternatives) and
`docs/partial-sync-implementation-brief.md` (what to build). It supersedes ADR-0004 and ADR-0005.

This ADR records the implementation decisions taken when planning that work
(`docs/plans/partial-sync.md`).

## Decision

1. **Projections are per canonical query.** A projection is identified by a hash of the whole
   resolved Tracked Query tree: `resource`, `where`, `limit`, `sort`, and every include step with
   its own `where`/`limit`/`orderBy`. A projection owns its step nodes; steps are not shared
   across projections. Authorization scope is whatever the Remote Query handler wrote into
   `where`, so it is part of the hash.
2. **One source position per committed transaction**, assigned by the storage layer after
   commit. A write outside a transaction gets its own position. The engine processes positions
   one at a time, in order, and collects its output into one `QueryWindowDelta` per projection
   per position.
3. **The log and positions live in memory for v1**, behind `SourcePositionAllocator` and
   `QueryLogStore` interfaces so a persisted implementation can replace them. A cursor carries
   the server epoch; a restart or an expired lease answers `CURSOR_EXPIRED`.
4. **Subscribed queries stop receiving `SYNC`.** They receive `SNAPSHOT`, `QUERY_DELTA`, and
   `CURSOR_EXPIRED`, keyed by `queryId`. Each `added`/`updated` entry carries its
   `originMutationId` so optimistic reconciliation keeps working.
5. **On resume the server re-runs the Remote Query handler** and requires the result to hash to
   the cursor's `queryId`. Building the query reads no collection; a mismatch is
   `CURSOR_EXPIRED`.
6. **Client retention is the union of memberships.** Each query persists its member
   `(resource, id)` set with its cursor. A row is deleted only when no persisted set holds it and
   it has no pending optimistic mutation.
7. **Boundary reads may observe commits later than the position being processed.** Processing is
   serial and client apply is idempotent (upsert on `added`, no-op on `removed` of an absent row,
   last-writer-wins patches), so the client converges. A randomized invariant suite guards this.

## Consequences

- Two existing bugs must be fixed first: queries differing only in `limit`/`sort` share a window,
  and include steps are shared across unrelated root queries (U01).
- The engine's per-row, fire-and-forget `handleMutation` becomes awaitable and batch-driven
  (U04). This takes the place of the "split `handleMutation`" step of the paused query-engine
  deepening work.
- Clients lose state on server restart (one fresh snapshot per query) until the log is persisted.
- Wire protocol break for subscribed queries; acceptable during the 1.0 canary.
