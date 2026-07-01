import { z } from "zod";

/**
 * Internal Tracked Query representation. A Custom Query handler returns an
 * unresolved query builder; the server mints a `RawQueryRequest` from it via
 * `buildQueryRequest()`, which the query engine subscribes and resolves against
 * storage. This is **not** an inbound client→server message — clients can only
 * invoke named Custom Query procedures (see ADR-0002).
 */
export const querySchema = z.object({
  resource: z.string(),
  where: z.record(z.string(), z.any()).optional(),
  include: z.record(z.string(), z.any()).optional(),
  limit: z.coerce.number().optional(),
  sort: z
    .array(z.object({ key: z.string(), direction: z.enum(["asc", "desc"]) }))
    .optional(),
});

export type RawQueryRequest = z.infer<typeof querySchema>;

export const queryPayloadSchema = z.record(
  z.string(),
  z.object({
    value: z.any().nullable(),
    _meta: z.object({ timestamp: z.string().optional().nullable() }).optional(),
  }),
);

const mutationPayloadSchema = queryPayloadSchema.superRefine((v, ctx) => {
  if (v["id"])
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Payload cannot have an id",
    });
});

const baseMutationSchema = z.object({
  id: z.string().optional(),
  type: z.literal("MUTATE"),
  resource: z.string(),
  resourceId: z.string().optional(),
});

const mutationMetaSchema = z
  .object({
    timestamp: z.string().optional(),
    originMutationId: z.string().optional(),
  })
  .optional();

export const genericMutationSchema = baseMutationSchema.extend({
  procedure: z.string(),
  payload: z.any().optional(),
  meta: mutationMetaSchema,
});

export type GenericMutation = z.infer<typeof genericMutationSchema>;

/**
 * Server→client field-level sync delta. Carries a committed storage write to
 * subscribed clients. `op` is a storage-operation marker (not a client
 * procedure) retained because client optimistic reconciliation still matches
 * on it. See ADR-0001.
 *
 * `DELETE` is a scope-out marker minted by the query engine (eviction from a
 * full window or a visible row leaving scope). It carries only the `resourceId`
 * with an empty `payload`; the client drops the row from the affected window
 * (see ADR-0003). It is not a storage delete — the row may still exist in the
 * database, just outside this query's scope.
 */
export const syncDeltaSchema = z.object({
  id: z.string().optional(),
  type: z.literal("SYNC"),
  resource: z.string(),
  resourceId: z.string(),
  op: z.enum(["INSERT", "UPDATE", "DELETE"]),
  payload: mutationPayloadSchema,
  meta: mutationMetaSchema,
});

export type SyncDelta = z.infer<typeof syncDeltaSchema>;

export const mutationSchema = genericMutationSchema;

export type RawMutationRequest = z.infer<typeof mutationSchema>;

export const customQuerySchema = z.object({
  resource: z.string(),
  procedure: z.string(),
  input: z.any().optional(),
});

export type CustomQueryRequest = z.infer<typeof customQuerySchema>;
