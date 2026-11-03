# Program: partial sync

Status: active
Last updated: 2026-11-03

## Goal

When a client reconnects to a subscribed Remote Query, it ends up with exactly the rows a fresh
fetch would return, across the whole result tree (root rows and included rows). The server sends
only what changed and performs no collection read at reconnect.

Design: `docs/partial-sync-frontier.md` (rationale) and `docs/partial-sync-implementation-brief.md`
(what to build). Implementation decisions: ADR-0006.

## Definition of Done

- [ ] Resuming at any position within the lease leaves the client's rows, included rows among them, equal to a fresh fetch — check: U09 fuzz suite.
- [ ] A client receives every delta after its position exactly once, in order, including deltas published during the handoff — check: U06 handoff race test and U09.
- [ ] A window never appears short: a removal and its replacement land in one delta — check: test with a scope-out and its backfill in one transaction.
- [ ] A row entering by insert, update scope-in, eviction backfill, or promotion arrives with its full subtree — check: one test per entry path.
- [ ] Reconnect issues no collection read — check: storage spy in U09.
- [ ] Expired lease or server restart answers `CURSOR_EXPIRED` and the client recovers with a fresh snapshot — check: test.
- [ ] No code path sends `SYNC` for subscribed queries — check: grep and protocol tests.
- [ ] `pnpm typecheck`, `pnpm lint -- --diagnostic-level error`, and `pnpm test` pass for `./packages/*`.

Out of scope: multiple server processes, log compaction, a persisted log (only the interface
seam), the shared entity log (alternative C), deduplicating replays across a client's queries,
authorization changes while offline.

## Rules

- Each unit is one PR that leaves trunk green. CI trio from `CLAUDE.md` before opening.
- No compat shims beyond the U05 delta→`SYNC` adapter, which U08 deletes.
- Every engine unit adds tests through the engine or server API, not only unit tests of helpers.
- Units running in parallel touch disjoint files. A unit that must touch another unit's files
  stops and records an open question.
- No `console.log`/`console.warn` in library code.

## Units

| id | title | deps | state | owner | pr | dod |
|---|---|---|---|---|---|---|
| U00 | Commit plan, ADR-0006, and design docs | - | in-review | - | https://github.com/pedroscosta/live-state/pull/223 | Plan and ADR on main; check: files present |
| U01 | Fix projection identity: hash the full query tree, projections own their step nodes | - | in-review | session-2 | https://github.com/pedroscosta/live-state/pull/224 | `limit(10)`/`limit(20)` and two roots sharing an include get separate nodes and correct deltas; check: engine tests |
| U02 | Fix backfillWindow to emit rows with their full include subtree | U01 | todo | - | - | Backfilled and promoted rows arrive with includes; check: windowed-includes e2e test |
| U03 | Assign one source position per committed transaction and deliver batches to the server | - | todo | - | - | Positions strictly increase, one per transaction, one per non-transaction write; check: storage tests |
| U04 | Process batches serially in the engine with output into a collector | U02, U03 | todo | - | - | `handleMutation` awaitable; transactions never interleave; existing suite unchanged; check: interleaving test + full suite |
| U05 | Add projections that collect one QueryWindowDelta per position with included-row refcounts | U04 | todo | - | - | Classification table and refcount 0↔1 rules hold per position; check: projection tests |
| U06 | Add QueryLogStore, lease, epoch, subscribe/resume handoff, CURSOR_EXPIRED | U05 | todo | - | - | Projection outlives socket until `retainUntil`; handoff exactly-once; check: server tests incl. race |
| U07 | Client store foundations: atomic KV transaction, (resource,id) graph keys, membership sets, applyQueryDelta | - | todo | - | - | Delta + cursor persist in one IDB transaction; union retention; check: client store tests |
| U08 | Switch the wire protocol to SNAPSHOT/QUERY_DELTA/CURSOR_EXPIRED with resume on reconnect | U06, U07 | todo | - | - | Reconnect resumes with deltas; no `SYNC` for subscriptions; #217 closed; check: e2e reconnect tests + grep |
| U09 | Add the randomized partial-sync invariant suite | U08 | todo | - | - | Fresh-fetch equality, exactly-once order, zero collection reads on reconnect; check: fuzz suite in CI |

States: todo, claimed, in-review, done, blocked.

### Unit notes

- **U01.** Today `hashStep` omits `limit`/`sort` and `buildSteps` strips `include`, so the root hash
  ignores the tree; include steps hash only their own path, so `posts.where(a).include(author)` and
  `posts.where(b).include(author)` share one `author` node whose `parentQuery` is the first root.
  Probe (2026-11-03) confirmed both. Fix: projection id = canonical hash of the resolved tree with
  stable key order; step node keys are namespaced by projection id.
- **U02.** `backfillWindow` and `demoteAndBackfill` read with only the sort include and emit a bare
  row. Read with `buildIncludeFromChildQueries` merged with the sort include and emit through
  `sendInsertsForTree`.
- **U03.** Choke point: `SQLStorage.transaction` calls `notifyMutations(transactionStack)` after
  commit; non-transaction writes notify per row from `trackMutation`. Allocator interface
  `SourcePositionAllocator` with an in-memory implementation and an `epoch`.
- **U04.** Today `handleMutation` runs per row and starts un-awaited async work
  (`getMatchingQueries(...).then(...)`, `handleRelationalSortFanout`, backfill reads), so
  transactions interleave. Make it return a promise, process one batch at a time from a queue on
  `Server`, and route every emission through a sink so U05 can collect per position.
- **U05.** Refcounts are new: today included rows never leave. Root "in" = in window (or matches
  `where` when unwindowed); included "in" = refcount > 0. Entering brings the subtree; rows whose
  count goes 0→1 are `added`, →0 are `removed`. Temporary adapter turns deltas into `SYNC` so the
  wire is unchanged until U08.
- **U06.** Subscription states `buffering → replaying → live`, no `await` between sending the
  replay and going live. Append + publish is one synchronous step. `retainUntil` default is
  configurable (pick a default in the unit, e.g. 5 minutes).
- **U07.** `ObjectGraph` keys nodes by bare id (`obj-graph.ts:25,37`); `KVStorage` has no
  transaction API and its writes are fire-and-forget. Cursors in `__meta` must be dropped when a
  resource store is reset for a schema change.
- **U08.** Server re-runs the handler on resume and compares the projection id (ADR-0006 §5).
  Close PR #217 as superseded once this lands, reusing its subscription-id-on-reconnect parts.

## Decisions

- 2026-11-03: Log and positions in memory for v1, behind interfaces so they can be persisted later; cursors carry a server epoch. (ADR-0006 §3)
- 2026-11-03: Replace `SYNC` for subscribed queries with `SNAPSHOT`/`QUERY_DELTA`/`CURSOR_EXPIRED`. (ADR-0006 §4)
- 2026-11-03: Client retention is the union of persisted query memberships; PR #217 will be closed as superseded. (ADR-0006 §6)
- 2026-11-03: Query-engine deepening (TotalOrder next) is paused; U04 replaces its "split `handleMutation`" step.
- 2026-11-03: Projection identity is the full resolved tree hash; auth scope is the handler-built `where`; resume re-runs the handler. (ADR-0006 §1, §5)
- 2026-11-03: Boundary reads may see later commits; serial processing plus idempotent client apply converge, guarded by U09. (ADR-0006 §7)
- 2026-11-03 (U01): Projection id is a 64-bit canonical hash (two seeded xxHash32 passes, 14 base-36 chars); empty `where`/`sort` hash as absent; step node key is `${projectionId}:${JSON.stringify(path)}`. U06/U08 can use the projection id as the wire `queryId`.

## Open questions

- Default lease length — options: 1 min, 5 min, 30 min — recommendation: 5 min, configurable on `server()`; decide in U06.

## Session log

- 2026-11-03 planning: grilled, probed engine identity bugs, wrote plan and ADR-0006. Next: start U01, U03, or U07 (independent) via `bun ~/.claude/skills/pedro-mode/scripts/program.ts docs/plans/partial-sync.md next`.
- 2026-11-03 session-2: U01 done in review as PR #224, stacked on #223. Two review rounds; e2e tests need Postgres 16 on :5432 with DBs `live_state_e2e_test`, `live_state_query_engine_test`, `live_state_benchmark_test`. Next: U02 (stack on `feat/u01-projection-identity`) or the independent U03/U07; run `bun ~/.claude/skills/pedro-mode/scripts/program.ts docs/plans/partial-sync.md next`.
