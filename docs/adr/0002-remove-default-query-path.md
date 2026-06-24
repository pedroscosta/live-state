---
status: accepted
---

# Remove the default-query path; queries are custom-only

## Context

A `collectionRoute(schema.users)` exposed an implicit **Default Query**: the client called `store.query.users.where(...).get()/.subscribe()`, building a `RawQueryRequest` (`{resource, where, include, limit, sort, lastSyncedAt}`) and sending it directly over the wire (via `useLoadData`/`client.load`, or the fetch client's GET). The server accepted it (`querySchema` is part of the inbound `queryRequestSchema` union), resolved it via `Route.handleQuery` → `batcher.rawFind`, and subscribed it through the query engine. This let any client hand the server an arbitrary `where`/`include`/`limit` shape, gated only by an optional `read` clause on the route.

Two distinct things were tangled together here, and naming them apart is the crux of this decision:

- The **Default Query** is the *server-bound* path: the client authors a read shape and the **server** executes it. This is what we remove.
- The same `store.query.users.where(...)` builder on the websocket client *also* drives a **Local Query** — `.get()/.subscribe()` against the client's optimistic store, with **no server round-trip**, which is how `useLiveQuery` reads cached data. The builder served double duty (local read **and** server load); only the server-load wiring (`buildQueryRequest → client.load`) is the Default Query.

This mirrors the situation ADR-0001 untangled for mutations. As there, the type doing the client-facing work — `RawQueryRequest` — is **doing double duty**:

1. **A client→server request** — the Default Query a client sends to read data.
2. **The internal tracked-query representation** — a Custom Query handler returns an *unresolved* query builder (`return db.posts.where(...)`); the server calls `buildQueryRequest()` to mint a `RawQueryRequest`, which the query engine subscribes and resolves against storage for realtime updates.

So "remove default queries" cannot mean deleting `RawQueryRequest` or the query engine — Custom Queries (and Local Queries) depend on both. Nor can it mean deleting the client `QueryBuilder` — `useLiveQuery` needs it for local reads. It means deleting only the *inbound* request side, exactly as ADR-0001 did for `MUTATE`.

A second entanglement: raw-query resolution (`handleQuery`/`rawFind`) lived only on `Route` (the `collectionRoute` class), and the query engine resolved *every* tracked query — including those returned by Custom Query handlers — by calling back into `routes[resource].handleQuery`. `batcher.rawFind`, however, is a pure batching layer over `Storage` keyed only by `resource`; the route indirection carried no resolution logic of its own, only the per-resource `read` auth merge in `incrementQueryStep`.

## Decision

Delete the Default Query path and make Custom Queries the only client read API:

- **Remove the inbound raw-query request.** Drop `querySchema` from the inbound `queryRequestSchema` union (it survives only as the internal Tracked Query type), delete `Server.handleQuery`, and delete the raw branches in both transports (`web-socket.ts`, `http.ts`). Inbound query dispatch becomes unconditionally Custom Query (`{resource, procedure, input}`).
- **Resolve Tracked Queries off the route (done in #173), and later delete `collectionRoute`/`Route`.** The query engine already resolves Tracked Queries directly against `batcher`/storage keyed by `resource`, dropping the `router.get → routes[resource].handleQuery` indirection. With that indirection gone, `collectionRoute`/`Route` carry no remaining resolution logic and can become procedure-only (`ProcedureRoute`) — a resource is queryable by virtue of being in the `schema`, not because a route is declared for it. **This route deletion is future work and is *not* part of this change set: `collectionRoute(...)` is still declared (see the examples above), and `Route.handleQuery` survives as dead code until that slice lands.**
- **Remove the client default-query surface, asymmetrically:**
  - **Websocket client** — keep `store.query.<resource>` as a `QueryBuilder` for **Local Query** reads (`useLiveQuery`), but sever its server-load path: `useLoadData`/`client.load` accept only a `CustomQueryRequest`, so a bare builder's `RawQueryRequest` can no longer be loaded to the server.
  - **Fetch client** — has no optimistic store to back a Local Query, so drop the builder entirely: delete the `Object.hasOwn(schema, prop) → QueryBuilder._init` branch and the GET read, leaving only named **Custom Query** procedures.
- **Keep `RawQueryRequest`** as the internal Tracked Query representation, the server-side `db.<resource>` builder that handlers use to express what to track, and the client-side Local Query builder backing `useLiveQuery`.

The Custom Query return contract is unchanged: a handler returning an unresolved builder is subscribed as a live Tracked Query; a handler returning a plain value is one-shot, and subscribing to a one-shot query remains a runtime error (lifting that distinction into the type system is a deferred improvement).

## Considered options

- **Keep `collectionRoute` as a schema-binding-only declaration** that still owns `handleQuery`/`rawFind` for internal resolution while exposing nothing to clients. Rejected: forces a declare-it-twice ceremony per resource and preserves a class whose only remaining job is plumbing the engine already has (`storage` + `schema`).
- **Relocate per-resource `read` authorization to a storage/schema policy layer** so the engine keeps an automatic auth backstop during `include` expansion. Deferred: a larger design (backlog item #2). For this change, framework read-auth is dropped entirely.
- **Make Custom Queries tracked-only** (must return a builder), dropping the one-shot/computed path. Rejected: computed/aggregate reads are a real need (see the "aggregations/groupBy" checklist item).
- **Fold in the query-engine `include` rework** in the same pass. Rejected: that is a separate resolution-semantics change with its own parity risk; this change leaves the engine's `include`/realtime behavior untouched.

## Consequences

- For **server reads**, clients can only invoke named query procedures with validated input; any shaping power is whatever a procedure's input schema deliberately exposes. The server no longer runs arbitrary client-supplied `where`/`include` trees.
- **Local Queries are unaffected.** `store.query.<resource>.where(...).get()/.subscribe()` still works on the websocket client against the optimistic store; `useLiveQuery` is unchanged. The data such a query reads gets into the store via Custom Query loads (`useLoadData`) and optimistic mutations — never by the client shaping a server read.
- **Read authorization becomes 100% the handler's responsibility**, expressed as where-clauses — *including inside every `include` sub-query*. There is no automatic per-resource backstop: a handler returning `db.users.include({ posts: true })` will over-fetch related rows unless the handler filters them. This is an accepted, documented footgun until storage-layer policies land (backlog item #2).
- `lastSyncedAt` is removed as dead code (declared but never consumed downstream).
- This is a breaking wire-protocol and client-API change requiring a major version bump. Docs, examples, and READMEs must stop guiding users to **load** data with `store.query.<resource>.where(...)` (use a Custom Query procedure via `useLoadData`), while still using the same builder for **local** reads via `useLiveQuery`.
