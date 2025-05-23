import { z } from "zod";
import {
  defaultMutationSchema,
  defaultPayloadSchema,
  genericMutationSchema,
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

export const clSyncMsgSchema = z.object({
  id: msgId,
  type: z.literal("SYNC"),
  lastSyncedAt: z.string().optional(),
  resources: z.string().array().optional(),
  where: z.record(z.any()).optional(),
});

export const defaultMutationMsgSchema = defaultMutationSchema.extend({
  id: msgId,
});

export type DefaultMutationMessage = z.infer<typeof defaultMutationMsgSchema>;

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
  clSyncMsgSchema,
  mutationMsgSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/*
 * Server messages
 */

export const svSyncMsgSchema = z.object({
  id: msgId,
  type: z.literal("SYNC"),
  resource: z.string(),
  data: z.record(defaultPayloadSchema),
});

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
  svSyncMsgSchema,
  svRejectMsgSchema,
  svReplyMsgSchema,
  defaultMutationMsgSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
