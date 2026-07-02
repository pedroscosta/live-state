# Backlog

Engineering backlog for simplifying `@live-state/sync`: fewer implicit behaviors, thinner query processing, and explicit server-side patterns.

---

## 1. Remove default mutations

**Goal:** Drop built-in `insert` / `update` handling on `Route` so **custom mutations only** (`withProcedures` / procedures) are the supported path.

**Why:** Default mutations duplicate what explicit procedures can express; they pull in deprecated surface area (automatic optimistic updates, `handleSet`, default mutation protocol, etc.). Custom mutations already offer typed input/output, `ServerDB` access, and optimistic flows via `defineOptimisticMutations`.

**Related work / notes:**

- Audit parity: inserts/updates via `db.<resource>` are already covered; lifecycle hooks today are tied to default mutations via storage (`rawInsert` / `rawUpdate` + `hooks`) — decide whether hooks move into handlers only (recommended in `REMOVE_DEFAULT_MUTATIONS.md`) or get a new home.
- Migration: document or codemod from declarative `insert` / `update` auth + `withHooks` to inline checks and side effects inside procedure handlers.
- See `REMOVE_DEFAULT_MUTATIONS.md` for the full phased plan.

---

## 2. Remove authorization checks

**Goal:** Remove **framework-level** authorization from routes (e.g. declarative `insert` / `update` auth, route-level auth plumbing tied to default mutations).

**Why:** Authorization should live in explicit procedure handlers, middleware, or storage policies — not in a parallel declarative API that only default mutations used. Aligns with “explicit > implicit” and reduces surface area once default mutations are gone.

**Scope clarification:** This is about deleting the **built-in** auth integration on `Route` / protocol paths that exist for legacy flows. Application code must still enforce auth inside custom mutations or adapters; the backlog item is **removal of the library’s default auth hooks**, not “stop securing APIs.”

---

## 3. Remove custom query-engine handling of `include` — use storage include handlers

**Goal:** Strip the **query engine** logic that resolves `include` (nested relation loading / graph expansion) in favor of **storage-layer include handlers**. Keep **realtime updates** as they are today.

**Why:** Centralizing `include` in storage avoids duplicating relation semantics between the query engine and persistence; storage already knows how to join or batch-load related rows.

**Explicitly in scope:**

- Remove or bypass the query-engine code path that interprets `include` on queries.

**Explicitly out of scope / unchanged:**

- Realtime subscription and invalidation behavior — **maintained**.
- Client query builders may still express `.include(...)` for API ergonomics; execution should delegate to storage (see also `MIGRATE_INCLUDE_SYNTAX.md` for client-side include shape migration).

**Follow-up:** Ensure one clear contract for “include” resolution (storage-only), update tests, and document how relation loads map to storage APIs.

---

## 4. Update documentation

**Goal:** Bring **public docs** (`docs/`), **package READMEs**, **examples/**, and **migration notes** in line with the backlog above so users are not guided toward removed APIs.

**Why:** Removing default mutations, framework auth hooks, and query-engine `include` changes how integrations are built. Stale docs cause churn and support load; shipping behavior changes without doc updates breaks trust.

**What to cover (non-exhaustive):**

- **Default mutations:** Replace tutorials and snippets that use `Route` insert/update, `withHooks` for insert/update lifecycle, or default optimistic flows; point to `withProcedures`, `defineOptimisticMutations`, and `REMOVE_DEFAULT_MUTATIONS.md` (or fold key bits into official docs once stable).
- **Authorization:** Document that auth belongs in procedure handlers, middleware, or your storage/adapter layer — not removed “security,” but removed **library** auth APIs.
- `**include`:** Explain that relation expansion is **storage-driven**; keep `MIGRATE_INCLUDE_SYNTAX.md` aligned with the final client query shape; add or update a short “how includes execute” page if needed.
- **Changelog / release notes:** Call out breaking changes and migration steps for each release that lands items 1–3.

**Cadence:** Prefer **small doc PRs alongside** each code change; use a final **docs sweep** before a major version if multiple items ship together.

---

## Ordering suggestion

1. **Default mutations** — largest API and protocol impact; unlocks cleaning auth tied to them.
2. **Authorization checks** — natural cleanup after default mutations are removed (or in parallel where decoupled).
3. **Include in query engine → storage** — orthogonal to mutations; can be scheduled once storage include handlers are ready and tests cover parity.
4. **Update documentation** — run in parallel with each item above; finish with a release-notes and examples pass before tagging a breaking release.