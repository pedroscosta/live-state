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
  })
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

export const genericMutationSchema = baseMutationSchema.extend({
  procedure: z.string(),
  payload: z.any().optional(),
});

export type GenericMutation = z.infer<typeof genericMutationSchema>;

export const defaultMutationSchema = baseMutationSchema.extend({
  procedure: z.enum(["INSERT", "UPDATE"]),
  payload: mutationPayloadSchema,
});

export type DefaultMutation = Omit<
  z.infer<typeof defaultMutationSchema>,
  "resourceId"
> & {
  resourceId: string;
};

export const mutationSchema = z.union([
  defaultMutationSchema,
  genericMutationSchema,
]);

export type RawMutationRequest = z.infer<typeof mutationSchema>;
