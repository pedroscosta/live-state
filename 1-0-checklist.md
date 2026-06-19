# 1.0 Checklist

Release checklist for `@live-state/sync` 1.0 — fewer implicit behaviors, thinner internals, explicit server-side patterns.

- [ ] **Simplify query engine** — Remove `include` resolution and other duplicated persistence logic from `QueryEngine`; delegate relation loading to storage while keeping realtime subscription and invalidation behavior unchanged.
- [ ] **Partial bootstrapping** — Stop blocking client readiness on loading every schema entity from IndexedDB; reach `local` bootstrap once the resources active queries actually need are hydrated.
- [ ] **Remove default queries** — Drop the implicit `RawQuery` path on `collectionRoute` (`store.query.users.where(...)`) so reads go through explicit query procedures in `withProcedures`, mirroring the default-mutation removal.
- [ ] **Rewrite docs** — Update `docs/`, `examples/`, package READMEs, and migration notes so nothing guides users toward removed default queries, mutations, or query-engine `include` handling.
- [ ] **Redo database setup** — Rework `SQLStorage` initialization and schema migration (`schema-init`, `_meta` tables, Kysely wiring) so persistence setup is simpler, more predictable, and aligned with the storage-driven query model.
- [ ] **Improve query system to allow more use cases** — Close the gaps stubbed in `query-use-cases.test.ts`: cursor/offset pagination, text search, aggregations/groupBy, field projection, multi-operator filters, and Date range support in the in-memory matcher.
