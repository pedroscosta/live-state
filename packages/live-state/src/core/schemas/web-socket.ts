import { z } from "zod";
import {
  defaultMutationSchema,
  genericMutationSchema,
  queryPayloadSchema,
  querySchema,
} from "./core-protocol";

export const msgId = z.string();

/*
 * Client messages
 */

export const clSubscribeMsgSchema = z.object({
  id: msgId,
  type: z.literal("SUBSCRIBE"),
  resource: z.string(),
});

export const clQueryMsgSchema = querySchema.extend({
  id: msgId,
  type: z.literal("QUERY"),
});

export const defaultMutationMsgSchema = defaultMutationSchema.extend({
  id: msgId,
});

export type DefaultMutationMessage = Omit<
  z.infer<typeof defaultMutationMsgSchema>,
  "resourceId"
> & {
  resourceId: string;
};

export const genericMutationMsgSchema = genericMutationSchema.extend({
  id: msgId,
});

export const mutationMsgSchema = z.union([
  genericMutationMsgSchema,
  defaultMutationMsgSchema,
]);

export type MutationMessage = z.infer<typeof mutationMsgSchema>;

export const clientMessageSchema = z.union([
  clSubscribeMsgSchema,
  clQueryMsgSchema,
  mutationMsgSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/*
 * Server messages
 */

export const svRejectMsgSchema = z.object({
  id: msgId,
  type: z.literal("REJECT"),
  resource: z.string(),
  message: z.string().optional(),
});

export const svReplyMsgSchema = z.object({
  id: msgId,
  type: z.literal("REPLY"),
  data: z.any(),
});

export const serverMessageSchema = z.union([
  svRejectMsgSchema,
  svReplyMsgSchema,
  defaultMutationMsgSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const syncReplyDataSchema = z.object({
  resource: z.string(),
  data: z.record(z.string(), queryPayloadSchema),
});
