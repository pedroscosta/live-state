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
