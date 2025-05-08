import { type ZodType, type ZodUnion, z } from "zod";

const clMsgId = z.string().nanoid();

const clSubscribeMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("SUBSCRIBE"),
  resource: z.string(),
});

const clBootstrapMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("BOOTSTRAP"),
  resources: z.string().array().optional(),
});

// TODO split this into separate schemas
const mutationsMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("MUTATE"),
  resource: z.string(),
  mutationType: z.enum(["insert", "update"]),
  payload: z.record(z.any()),
  resourceId: z.string(),
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
  type: z.literal("BOOTSTRAP"),
  resource: z.string(),
  data: z.array(z.any()),
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
