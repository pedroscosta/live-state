import { z } from "zod";

export const querySchema = z.object({
  resource: z.string(),
  where: z.record(z.string(), z.any()).optional(),
  include: z.record(z.string(), z.any()).optional(),
  lastSyncedAt: z.string().optional(),
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
 */
export const syncDeltaSchema = z.object({
  id: z.string().optional(),
  type: z.literal("SYNC"),
  resource: z.string(),
  resourceId: z.string(),
  op: z.enum(["INSERT", "UPDATE"]),
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
