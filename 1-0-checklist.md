# 1.0 Checklist

Release checklist for `@live-state/sync` 1.0 — fewer implicit behaviors, thinner internals, explicit server-side patterns.

- [ ] **Simplify query engine** — Remove `include` resolution and other duplicated persistence logic from `QueryEngine`; delegate relation loading to storage while keeping realtime subscription and invalidation behavior unchanged.
- [ ] **Partial bootstrapping** — Stop blocking client readiness on loading every schema entity from IndexedDB; reach `local` bootstrap once the resources active queries actually need are hydrated.
- [x] **Remove default queries** — Drop the implicit *server-bound* `RawQuery` path (`useLoadData`/`client.load` of a raw query, fetch GET) so server reads go through explicit query procedures in `withProcedures`, mirroring the default-mutation removal. The client-only **Local Query** builder (`store.query.users.where(...).get()/.subscribe()`, read by `useLiveQuery`) survives on the websocket client; the fetch client is custom-query-only. See ADR-0002.
- [ ] **Rewrite docs** — Update `docs/`, `examples/`, package READMEs, and migration notes so nothing guides users toward removed default queries, mutations, or query-engine `include` handling.
- [ ] **Redo database setup** — Rework `SQLStorage` initialization and schema migration (`schema-init`, `_meta` tables, Kysely wiring) so persistence setup is simpler, more predictable, and aligned with the storage-driven query model.
- [ ] **Improve query system to allow more use cases** — Close the gaps stubbed in `query-use-cases.test.ts`: cursor/offset pagination, text search, aggregations/groupBy, field projection, multi-operator filters, and Date range support in the in-memory matcher.
- [ ] **Make testable** — Apps using live-state can write tests easily: clear seams for in-memory storage, deterministic client/server setup, and documented patterns for unit and integration tests without a real database or browser.
