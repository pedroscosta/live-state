/**
 * Regression test for issue #218: a nested query that reaches its parent
 * through a `one` relation must keep receiving later descendant inserts after
 * the related parent is updated.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { QueryEngine } from '../../../src/core/query-engine';
import type { RawQueryRequest, SyncDelta } from '../../../src/core/schemas/core-protocol';
import {
	createRelations,
	createSchema,
	id,
	number,
	object,
	reference,
	string,
} from '../../../src/schema';
import { Logger, LogLevel } from '../../../src/utils';

const organization = object('organizations', {
	id: id(),
	counter: number(),
});

const organizationUser = object('organizationUsers', {
	id: id(),
	userId: string(),
	organizationId: reference('organizations.id'),
});

const thread = object('threads', {
	id: id(),
	organizationId: reference('organizations.id'),
	read: string().nullable(),
});

const message = object('messages', {
	id: id(),
	threadId: reference('threads.id'),
	body: string(),
});

const organizationRelations = createRelations(organization, ({ many }) => ({
	organizationUsers: many(organizationUser, 'organizationId'),
	threads: many(thread, 'organizationId'),
}));

const organizationUserRelations = createRelations(
	organizationUser,
	({ one }) => ({
		organization: one(organization, 'organizationId'),
	}),
);

const threadRelations = createRelations(thread, ({ one, many }) => ({
	organization: one(organization, 'organizationId'),
	messages: many(message, 'threadId'),
}));

const messageRelations = createRelations(message, ({ one }) => ({
	thread: one(thread, 'threadId'),
}));

const schema = createSchema({
	organizations: organization,
	organizationUsers: organizationUser,
	threads: thread,
	messages: message,
	organizationRelations,
	organizationUserRelations,
	threadRelations,
	messageRelations,
});

const query: RawQueryRequest = {
	resource: 'organizationUsers',
	where: { userId: 'user-1' },
	include: {
		organization: {
			include: {
				threads: { include: { messages: true } },
			},
		},
	},
};

const field = (value: unknown) => ({
	value,
	_meta: { timestamp: '2026-08-27T00:00:00.000Z' },
});

const materialize = (value: Record<string, unknown>) => ({
	value: Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, field(entry)]),
	),
	_meta: { timestamp: '2026-08-27T00:00:00.000Z' },
});

const nestedResult = () => {
	const organizationValue = materialize({
		id: 'organization-1',
		counter: 0,
	});
	const threadValue = materialize({
		id: 'thread-1',
		organizationId: 'organization-1',
		read: null,
	});
	const initialMessageValue = materialize({
		id: 'message-initial',
		threadId: 'thread-1',
		body: 'initial message',
	});

	return {
		...materialize({
			id: 'membership-1',
			userId: 'user-1',
			organizationId: 'organization-1',
		}),
		value: {
			...materialize({
				id: 'membership-1',
				userId: 'user-1',
				organizationId: 'organization-1',
			}).value,
			organization: {
				value: {
					...organizationValue.value,
					threads: {
						value: [
							{
								...threadValue,
								value: {
									...threadValue.value,
									messages: {
										value: [initialMessageValue],
										_meta: { timestamp: '2026-08-27T00:00:00.000Z' },
									},
								},
							},
						],
						_meta: { timestamp: '2026-08-27T00:00:00.000Z' },
					},
				},
				_meta: { timestamp: '2026-08-27T00:00:00.000Z' },
			},
		},
		_meta: { timestamp: '2026-08-27T00:00:00.000Z' },
	};
};

const update = (
	resource: string,
	resourceId: string,
	payload: Record<string, ReturnType<typeof field>>,
	value: Record<string, unknown>,
): { mutation: SyncDelta; entityValue: ReturnType<typeof materialize> } => ({
	mutation: {
		type: 'SYNC',
		op: 'UPDATE',
		resource,
		resourceId,
		payload,
	},
	entityValue: materialize(value),
});

describe('nested one-relation query matching (issue #218)', () => {
	let engine: QueryEngine;
	let received: SyncDelta[];

	beforeEach(async () => {
		const storage = {
			get: async () => [nestedResult()],
		};

		engine = new QueryEngine({
			storage,
			schema,
			logger: new Logger({ level: LogLevel.CRITICAL }),
		});
		received = [];

		engine.subscribe(query, (mutation) => received.push(mutation));
		await engine.get(query);
		received = [];
	});

	const flush = async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	};

	test('keeps receiving a later message insert after parent updates', async () => {
		const organizationUpdate = update(
			'organizations',
			'organization-1',
			{ counter: field(1) },
			{ id: 'organization-1', counter: 1 },
		);
		engine.handleMutation(
			organizationUpdate.mutation,
			organizationUpdate.entityValue,
		);
		await flush();

		const threadUpdate = update(
			'threads',
			'thread-1',
			{ read: field('read-1') },
			{ id: 'thread-1', organizationId: 'organization-1', read: 'read-1' },
		);
		engine.handleMutation(threadUpdate.mutation, threadUpdate.entityValue);
		await flush();

		const reply: SyncDelta = {
			type: 'SYNC',
			op: 'INSERT',
			resource: 'messages',
			resourceId: 'message-reply',
			payload: {
				threadId: field('thread-1'),
				body: field('reply after read'),
			},
		};
		engine.handleMutation(
			reply,
			materialize({
				id: 'message-reply',
				threadId: 'thread-1',
				body: 'reply after read',
			}),
		);
		await flush();

		expect(
			received.some(
				(mutation) =>
					mutation.resource === 'messages' &&
					mutation.resourceId === 'message-reply',
			),
		).toBe(true);
	});
});
