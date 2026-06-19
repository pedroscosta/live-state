---
status: accepted
---

# Split the mutation request from the sync delta in the wire protocol

## Context

The `MUTATE` message type and its `defaultMutationSchema` were doing double duty. They were simultaneously:

1. **A client→server request** — the (deprecated) `INSERT`/`UPDATE` procedures a client sends to change data.
2. **The server→client sync delta** — a `type: "MUTATE"` message (`resourceId` + field-level `{ value, _meta }` payload) is emitted for *every* committed storage write, including writes caused by Custom Mutations, and pushed to subscribed clients. There are **two producers**: `sql-storage.ts` `buildMutation`/`notifySubscribers` (storage writes) and `core/query-engine/index.ts` (objects moving into/out of a live query's scope, e.g. `sendInsertsForTree`). Applied on the client at `client.ts` → `store.addMutation`.

This overload made the "remove default mutations" plan read as if deleting the client request also deleted the sync format — it does not, and deleting the schema would have broken all sync.

## Decision

Split the two concepts in the protocol:

- **`MUTATE`** becomes client→server only, carrying Custom Mutation procedures, and always receives a `REPLY` (or `REJECT`).
- A distinct **`SYNC`** server→client message carries the field-level delta. The schema formerly named `defaultMutationSchema` / `DefaultMutationMessage` is **renamed/repurposed into the Sync Delta schema, not deleted**. It retains an `op: "INSERT" | "UPDATE"` marker (a storage-operation indicator, not a client procedure) because client optimistic reconciliation still matches on it.

The field-level CRDT `mergeMutation` logic is unchanged and shared by server and client; only the message naming/typing is split.

## Considered options

- **Keep the `MUTATE` overload, delete only the client request path.** Rejected: leaves the sync broadcast misnamed as a "mutation" and preserves the conceptual confusion that produced a buggy removal plan.
- **Drop the `op` marker from the delta.** Deferred: requires rewriting reconciliation to key solely on `meta.originMutationId`; a separate, riskier change.

## Consequences

- Removing Default Mutations is now cleanly scoped to the client→server request side.
- The conditional REPLY-skip logic in the WebSocket transport disappears: every `MUTATE` replies unconditionally.
- This is a breaking wire-protocol change (client and server must upgrade together) and requires a major version bump.
