import { z, ZodType, ZodUnion } from "zod";

const clMsgId = z.string().nanoid();

const clSubscribeMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("SUBSCRIBE"),
  shape: z.string(),
});

// TODO: Add mutation schema
const mutation = z.string();

const clMutationsMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("MUTATE"),
  route: z.string(),
  mutations: z.array(mutation),
});

type ZodTypeWithMessageId = ZodType<{ _id: z.infer<typeof clMsgId> }>;

export const clientMessageSchema = z.union([
  clSubscribeMsgSchema,
  clMutationsMsgSchema,
]) satisfies ZodUnion<
  readonly [
    ZodTypeWithMessageId,
    ZodTypeWithMessageId,
    ...ZodTypeWithMessageId[],
  ]
>;

export type ClientMessage = z.infer<typeof clientMessageSchema>;

const svMutationsMsgSchema = z.object({
  type: z.literal("MUTATE"),
  shape: z.string(),
  mutations: z.array(mutation),
});

export const serverMessageSchema = svMutationsMsgSchema;

export type ServerMessage = z.infer<typeof serverMessageSchema>;
