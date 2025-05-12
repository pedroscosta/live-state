import { z } from "zod";

export const querySchema = z.object({
  type: z.literal("QUERY"),
  resource: z.string(),
  where: z.record(z.any()).optional(),
  include: z.record(z.any()).optional(),
});

export type RawQueryRequest = z.infer<typeof querySchema>;

export const defaultPayloadSchema = z
  .record(
    z.object({
      value: z.string().or(z.number()).or(z.boolean()).or(z.date()),
      _meta: z.object({ timestamp: z.string().optional() }).optional(),
    })
  )
  .superRefine((v, ctx) => {
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
});

export const genericMutationSchema = baseMutationSchema.extend({
  procedure: z.string(),
  payload: z.any(),
});

export type GenericMutation = z.infer<typeof genericMutationSchema>;

export const defaultMutationSchema = baseMutationSchema.extend({
  resourceId: z.string(),
  payload: defaultPayloadSchema,
});

export type DefaultMutation = z.infer<typeof defaultMutationSchema>;

export const mutationSchema = z.union([
  genericMutationSchema,
  defaultMutationSchema,
]);

export type RawMutationRequest = z.infer<typeof mutationSchema>;
