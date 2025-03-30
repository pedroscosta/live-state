import { z, ZodType, ZodUnion } from "zod";

const clMsgId = z.string().nanoid();

const clSubscribeMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("SUBSCRIBE"),
  shape: z.string(),
});

const clBootstrapMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("BOOTSTRAP"),
  objectName: z.string(),
});

export const objectMutationSchema = z.object({
  type: z.string(),
  values: z.record(z.string()),
  where: z.record(z.any()).optional(),
});

export type ObjectMutation = z.infer<typeof objectMutationSchema>;

const clMutationsMsgSchema = z.object({
  _id: clMsgId,
  type: z.literal("MUTATE"),
  route: z.string(),
  mutations: z.array(z.string()),
});

type ZodTypeWithMessageId = ZodType<{ _id: z.infer<typeof clMsgId> }>;

export const clientMessageSchema = z.union([
  clSubscribeMsgSchema,
  clMutationsMsgSchema,
  clBootstrapMsgSchema,
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
  mutation: z.string(),
});

const svBootstrapMsgSchema = z.object({
  type: z.literal("BOOTSTRAP"),
  objectName: z.string(),
  data: z.array(z.any()),
});

export type ServerBootstrapMessage = z.infer<typeof svBootstrapMsgSchema>;

export const serverMessageSchema = z.union([
  svMutationsMsgSchema,
  svBootstrapMsgSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
