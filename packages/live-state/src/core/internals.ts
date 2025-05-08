import { type ZodType, type ZodUnion, z } from "zod";

const clMsgId = z.string().nanoid();

const clSubscribeMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("SUBSCRIBE"),
  resource: z.string(),
});

const clBootstrapMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("SYNC"),
  lastSyncedAt: z.string().optional(),
  resources: z.string().array().optional(),
});

const payloadSchema = z
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

const mutationsMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("MUTATE"),
  resource: z.string(),
  resourceId: z.string(),
  payload: payloadSchema,
});

export type MutationMessage = z.infer<typeof mutationsMsgSchema>;

type ZodTypeWithMessageId = ZodType<{ _id: z.infer<typeof clMsgId> }>;

export const clientMessageSchema = z.union([
  clSubscribeMsgSchema,
  mutationsMsgSchema,
  clBootstrapMsgSchema,
]) satisfies ZodUnion<
  readonly [
    ZodTypeWithMessageId,
    ZodTypeWithMessageId,
    ...ZodTypeWithMessageId[],
  ]
>;

export type ClientMessage = z.infer<typeof clientMessageSchema>;

const svBootstrapMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("SYNC"),
  resource: z.string(),
  data: z.record(payloadSchema),
});

export type ServerBootstrapMessage = z.infer<typeof svBootstrapMsgSchema>;

const svRejectMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("REJECT"),
  resource: z.string(),
});

export type ServerRejectMessage = z.infer<typeof svRejectMsgSchema>;

export const serverMessageSchema = z.union([
  mutationsMsgSchema,
  svBootstrapMsgSchema,
  svRejectMsgSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
