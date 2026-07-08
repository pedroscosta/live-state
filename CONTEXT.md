# live-state/sync

The shared language of `@live-state/sync` — a real-time sync engine with a client store and ORM. This file is a glossary, not a spec.

## Language

### Mutations

**Mutation**:
A client→server request to change data, carried by the `MUTATE` message (client→server only). Going forward, the only kind is a **Custom Mutation** — an explicitly defined procedure (via `withProcedures`) with its own input schema, handler, and typed reply. Every `MUTATE` receives a `REPLY` (or `REJECT`).
_Avoid_: Default mutation (being removed), `insert`/`update` as protocol procedures.

**Custom Mutation**:
A mutation defined explicitly on a route with `withProcedures({ mutation })`. Has full handler control over `db` (ServerDB), any input schema, any return type, and optional optimistic support via `defineOptimisticMutations`.

**Default Mutation**:
*(Deprecated, being removed.)* The built-in `insert`/`update` procedures auto-generated on a `Route`, with declarative authorization, lifecycle hooks, and automatic optimistic updates. The removal plan retires this entire concept as a client API.

### Queries

**Query**:
A client→server read request. Going forward, the only kind a client can send is a **Custom Query** — clients invoke a named query procedure with validated input; they can no longer hand the server an arbitrary read shape.
_Avoid_: Default Query (being removed).

**Custom Query**:
A query defined explicitly on a route with `withProcedures({ query })`. Has full handler control over `db` (ServerDB) and any input schema. A handler either returns a plain computed value (one-shot) or returns an unresolved query builder, which the server resolves and subscribes as a **Tracked Query** for realtime updates.

**Default Query**:
*(Deprecated, being removed.)* The **server-bound** raw-query path: a client authors an arbitrary `where`/`include`/`limit`/`sort` shape and the *server* executes it. Carried by `useLoadData`/`client.load` (raw `RawQueryRequest` over the wire) and the fetch client's GET read. Removal deletes the inbound raw-query message, `Server.handleQuery`, and the raw-query transport branches — clients can only request server reads via a **Custom Query**.
_Avoid_: conflating with **Local Query** — the client-only read surface survives.

**Local Query**:
The client-only `store.query.<resource>.where(...).get()/.subscribe()` builder that reads the client's optimistic store with no server round-trip. Consumed by `useLiveQuery`. Survives the Default Query removal: it never hits the server, so it carries no read-authorization or wire-protocol concern. Data reaches the store via **Custom Query** loads (`useLoadData`) and optimistic mutations.
_Avoid_: Default Query (that is the removed server-bound path).

**Tracked Query**:
The internal query representation (historically `RawQueryRequest`) the query engine subscribes to, keyed by `resource`. Minted *server-side* from a Custom Query handler's returned query builder — never sent by a client. Surviving the Default Query removal as engine/storage internals, not a wire-exposed request.
_Avoid_: treating this as a client-facing request; after removal, clients cannot produce one directly. _Avoid_ saying the engine "resolves" it by sub-dividing into sub-queries — resolution (including `include`) is a single Storage query (see ADR-0003).

**Query Engine**:
The server-side component that maintains realtime subscriptions to **Tracked Queries** and broadcasts **Sync Deltas** to subscribed connections as committed writes change which objects are in **scope**. After ADR-0003 it does *not* resolve queries by breaking them into sub-queries; it delegates resolution to **Storage** (one query, `include` joins and all) and owns only matching-and-broadcasting.
_Avoid_: describing it as a query *resolver* or as the thing that runs sub-queries through routes (that path is gone).

**Relation Graph**:
The **Query Engine**'s in-memory graph of the objects it currently tracks and the relations between them, used for relation-membership matching and the reverse-ref fan-out (see ADR-0003). Each **Object Node** is keyed by id and holds only its outgoing relations (`references`), its inbound relations (`referencedBy`), and the set of query hashes it currently matches — no row payloads. The graph owns the paired `references`/`referencedBy` invariant and all inverse-relation-name resolution *internally*: callers traverse edges in query-relation terms (`reference(child, parentResource, parentRelation)`, `referencedBy(related, fromResource, relation)`) and never compute an inverse name. Writes enter through two methods — `ingest` (a resolved, possibly nested storage tree; additive) and `applyWrite` (a mutation; diff-aware, FK→null unlinks, re-parent = unlink+link).
_Avoid_: treating the graph as a store of rows (it holds no payloads); conflating **Object Node** membership (`matchedQueries`) with the **Window** ordering index (that is `WindowIndex`).

### Realtime scope

**Scope**:
The set of objects a **Tracked Query** currently matches and is therefore broadcasting changes for. For a query (or `include`) that declares a `limit`, scope is a bounded **Window**; for a windowed `include`, scope is maintained *per parent*.

**Window**:
The bounded scope of a Tracked Query (or `include`) that declares a `limit`: the top `N` objects under the query's total order. Membership is *relative* — whether an object is in the window depends on the other rows, not on the object alone.
_Avoid_: treating window membership as a per-object predicate; that is what makes windows different from plain `where`-matching.

**Scope-in / Scope-out**:
A committed write moving an object *into* / *out of* a Tracked Query's scope, broadcast as an `INSERT` / `DELETE` **Sync Delta**. A scope-out carries only the `id`; a scope-in carries the object's payload. Membership is judged *per tracked list*: `INSERT`/`DELETE` fire only on an actual entry/exit of that list. An object that changes — *including its relations* — but stays in the same scope produces a plain field `UPDATE`, never a `DELETE`+`INSERT`. A relation change decomposes into scope-out + scope-in only when the two parents' lists genuinely differ (e.g. a task moving from project A's window to project B's).
_Avoid_: treating "a relation changed" as the trigger; the trigger is always the membership transition.

**Eviction**:
A **Scope-out** caused not by a write to the evicted object, but by *another* object entering a full **Window** and displacing it. The displaced object is identified from in-memory window state, so eviction needs no database read.

**Backfill**:
Replacing an object that left a **Window** with the next object past the window boundary. Because the engine keeps no objects beyond the window, backfill is the one case that requires a database read on the broadcast path (see ADR-0003).

### Sync

**Sync Delta**:
A server→client `SYNC` message describing a field-level change to one resource: `{ resourceId, op: "INSERT" | "UPDATE", payload: { <field>: { value, _meta: { timestamp } } }, meta }`. Emitted by `notifySubscribers` (and the query engine's scope-change emitters) for *every* committed storage write regardless of which mutation caused it. This is the field-level CRDT format that keeps subscribed clients consistent. `op` is a storage-operation marker (not a client procedure), retained because client optimistic reconciliation still matches on it.
_Avoid_: calling this a "mutation" or "default mutation" — it is a delta broadcast, not a request. (`SYNC` is now a distinct server→client message; it no longer shares the `MUTATE` type — see ADR-0001.)

**Optimistic Mutation**:
A client-side handler (registered via `defineOptimisticMutations`) that predicts a Custom Mutation's effect locally for instant UI, reconciled or rolled back when the server's Sync Delta or rejection arrives. Opt-in and defined separately from the mutation.

### Merge vs Encode

**Merge** (`mergeMutation`):
The CRDT merge that folds a field-level payload into existing state. Used on both server (applying writes) and client (applying Sync Deltas). Core to sync — not tied to any mutation kind.

**Encode** (`encodeMutation`):
Converts a plain input object into the field-level `{ value, _meta }` payload shape. Deprecated alongside Default Mutation, but still used in the legacy server insert/update compatibility path.
