import { z } from 'zod';
import {
	customQuerySchema,
	defaultMutationSchema,
	genericMutationSchema,
	queryPayloadSchema,
	querySchema,
} from './core-protocol';

export const msgId = z.string();

/*
 * Client messages
 */

const queryRequestSchema = z.union([customQuerySchema, querySchema]);

export const clSubscribeMsgSchema = z
	.object({
		id: msgId,
		type: z.literal('SUBSCRIBE'),
	})
	.and(queryRequestSchema);

export const clUnsubscribeMsgSchema = z
	.object({
		id: msgId,
		type: z.literal('UNSUBSCRIBE'),
	})
	.and(queryRequestSchema);

export const clQueryMsgSchema = z
	.object({
		id: msgId,
		type: z.literal('QUERY'),
	})
	.and(queryRequestSchema);

export const clCustomQueryMsgSchema = z.object({
	id: msgId,
	type: z.literal('CUSTOM_QUERY'),
	resource: z.string(),
	procedure: z.string(),
	input: z.any().optional(),
});

export type CustomQueryMessage = z.infer<typeof clCustomQueryMsgSchema>;

export const defaultMutationMsgSchema = defaultMutationSchema.extend({
	id: msgId,
});

export type DefaultMutationMessage = Omit<
	z.infer<typeof defaultMutationMsgSchema>,
	'resourceId'
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
	clCustomQueryMsgSchema,
	mutationMsgSchema,
	clUnsubscribeMsgSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/*
 * Server messages
 */

export const svRejectMsgSchema = z.object({
	id: msgId,
	type: z.literal('REJECT'),
	resource: z.string(),
	message: z.string().optional(),
});

export const svReplyMsgSchema = z.object({
	id: msgId,
	type: z.literal('REPLY'),
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
	data: z.array(queryPayloadSchema),
});
