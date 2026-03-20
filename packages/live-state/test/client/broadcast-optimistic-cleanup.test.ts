import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineOptimisticMutations } from '../../src/client/optimistic';
import { createClient } from '../../src/client/websocket/client';
import {
	createSchema,
	id,
	number,
	object,
	string,
} from '../../src/schema';

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.CLOSED;
	url: string;
	eventListeners: Record<string, Array<(event: any) => void>> = {};

	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = MockWebSocket.CLOSED;
		this.dispatchEvent(new CloseEvent('close'));
	});

	constructor(url: string) {
		this.url = url;
		this.readyState = MockWebSocket.CONNECTING;
	}

	addEventListener(event: string, callback: (event: any) => void): void {
		if (!this.eventListeners[event]) {
			this.eventListeners[event] = [];
		}
		this.eventListeners[event].push(callback);
	}

	removeEventListener(event: string, callback: (event: any) => void): void {
		if (this.eventListeners[event]) {
			this.eventListeners[event] = this.eventListeners[event].filter(
				(cb) => cb !== callback,
			);
		}
	}

	dispatchEvent(event: Event): boolean {
		const listeners = this.eventListeners[event.type] || [];
		listeners.forEach((listener) => listener(event));
		return true;
	}

	simulateOpen(): void {
		this.readyState = MockWebSocket.OPEN;
		this.dispatchEvent(new Event('open'));
	}

	simulateMessage(data: any): void {
		this.dispatchEvent(new MessageEvent('message', { data }));
	}
}

vi.stubGlobal('WebSocket', MockWebSocket);

const posts = object('posts', {
	id: id(),
	title: string(),
	likes: number().default(0),
});

const schema = createSchema({
	posts,
});

type TestRouter = {
	routes: {
		posts: {
			resourceSchema: typeof posts;
			customMutations: {
				createPost: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<
						any,
						{ id: string; title: string; likes: number }
					>;
					handler: () => void;
				};
				updateLikes: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<
						any,
						{ id: string; likes: number }
					>;
					handler: () => void;
				};
			};
			customQueries: {};
		};
	};
};

const createTestClient = async (optimisticMutations?: any) => {
	const client = createClient<TestRouter>({
		url: 'ws://localhost:1234',
		schema,
		storage: false,
		optimisticMutations,
		connection: {
			autoConnect: false,
			autoReconnect: false,
		},
	});

	await client.client.ws.connect();
	const ws = (client.client.ws as any).ws as MockWebSocket;
	ws.simulateOpen();

	return { client, ws };
};

const getLastSentMessage = (ws: MockWebSocket) => {
	const calls = ws.send.mock.calls;
	if (calls.length === 0) return null;
	return JSON.parse(calls[calls.length - 1][0]);
};

const makeOptimisticMutations = () =>
	defineOptimisticMutations<TestRouter, typeof schema>({
		posts: {
			createPost: ({ input, storage }) => {
				storage.posts.insert({
					id: input.id,
					title: input.title,
					likes: input.likes,
				});
			},
			updateLikes: ({ input, storage }) => {
				storage.posts.update(input.id, {
					likes: input.likes,
				});
			},
		},
	});

const makeBroadcast = (
	id: string,
	resourceId: string,
	procedure: 'INSERT' | 'UPDATE',
	payload: Record<string, any>,
	originMutationId?: string,
) =>
	JSON.stringify({
		type: 'MUTATE',
		id,
		resource: 'posts',
		resourceId,
		procedure,
		payload: Object.fromEntries(
			Object.entries(payload).map(([k, v]) => [
				k,
				{ value: v, _meta: { timestamp: new Date().toISOString() } },
			]),
		),
		...(originMutationId ? { meta: { originMutationId } } : {}),
	});

describe('broadcast with originMutationId cleans up optimistic mutations', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.clearAllTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('broadcast with originMutationId removes optimistic insert before REPLY — record survives REPLY', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-1',
			title: 'Optimistic Post',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);

		// Optimistic record visible
		expect(client.store.query.posts.one('post-1').get()).toEqual(
			expect.objectContaining({ id: 'post-1', title: 'Optimistic Post' }),
		);

		// Broadcast arrives BEFORE REPLY with originMutationId linking back to the client message.
		// This is the scenario that previously caused a duplicate: the optimistic item and the
		// broadcast item would both be visible until the REPLY cleaned up the optimistic one.
		ws.simulateMessage(
			makeBroadcast('srv-1', 'post-1', 'INSERT', { title: 'Optimistic Post', likes: 0 }, sentMessage.id),
		);

		// After broadcast, the record is still visible (now from the server rawObjPool)
		expect(client.store.query.posts.one('post-1').get()).toEqual(
			expect.objectContaining({ id: 'post-1', title: 'Optimistic Post' }),
		);

		// REPLY arrives — confirmCustomMutation runs, but since the broadcast already
		// cleaned up the optimistic mutation, this should NOT remove the record.
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } }),
		);

		await expect(mutationPromise).resolves.toEqual({ ok: true });

		// The record must still be present (from the server broadcast).
		// Before the fix, confirmCustomMutation would have been a no-op anyway because
		// undoMutation checks the stack — but the key assertion is that the record survives.
		expect(client.store.query.posts.one('post-1').get()).toEqual(
			expect.objectContaining({ id: 'post-1', title: 'Optimistic Post' }),
		);

		client.client.ws.disconnect();
	});

	test('without originMutationId, old behavior: REPLY removes the optimistic record', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-old',
			title: 'Old Behavior',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);

		expect(client.store.query.posts.one('post-old').get()).toBeDefined();

		// Broadcast WITHOUT originMutationId (different server ID, so it won't match)
		ws.simulateMessage(
			makeBroadcast('srv-different-id', 'post-old', 'INSERT', { title: 'Old Behavior', likes: 0 }),
		);

		// Optimistic record is still in the stack (broadcast ID doesn't match optimistic ID)
		// So the record is visible from both optimistic and server — this is the "duplicate" scenario
		expect(client.store.query.posts.one('post-old').get()).toBeDefined();

		// REPLY removes the optimistic mutation via confirmCustomMutation
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } }),
		);
		await expect(mutationPromise).resolves.toEqual({ ok: true });

		// Record still present from server broadcast
		expect(client.store.query.posts.one('post-old').get()).toBeDefined();

		client.client.ws.disconnect();
	});

	test('broadcast with originMutationId for update removes the optimistic update', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		// Seed a base record from the server
		ws.simulateMessage(
			makeBroadcast('srv-init', 'post-3', 'INSERT', { title: 'Base Post', likes: 5 }),
		);

		expect(client.store.query.posts.one('post-3').get()).toEqual(
			expect.objectContaining({ id: 'post-3', likes: 5 }),
		);

		// Optimistic update
		const mutationPromise = client.store.mutate.posts.updateLikes({
			id: 'post-3',
			likes: 10,
		});

		const sentMessage = getLastSentMessage(ws);

		// Optimistic value applied
		expect(client.store.query.posts.one('post-3').get()).toEqual(
			expect.objectContaining({ id: 'post-3', likes: 10 }),
		);

		// Broadcast arrives with confirmed value and originMutationId
		ws.simulateMessage(
			makeBroadcast('srv-upd', 'post-3', 'UPDATE', { likes: 10 }, sentMessage.id),
		);

		// Value is 10 from server
		expect(client.store.query.posts.one('post-3').get()).toEqual(
			expect.objectContaining({ id: 'post-3', likes: 10 }),
		);

		// REPLY is a no-op
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } }),
		);
		await expect(mutationPromise).resolves.toEqual({ ok: true });

		// Value still 10
		expect(client.store.query.posts.one('post-3').get()).toEqual(
			expect.objectContaining({ id: 'post-3', likes: 10 }),
		);

		client.client.ws.disconnect();
	});

	test('broadcast with non-matching originMutationId does not clean up optimistic stack', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-4',
			title: 'Still Optimistic',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);

		// Broadcast with a wrong originMutationId
		ws.simulateMessage(
			makeBroadcast('srv-wrong', 'post-4', 'INSERT', { title: 'Still Optimistic', likes: 0 }, 'nonexistent-id'),
		);

		// The optimistic record should still be in the stack (not cleaned up),
		// so when REPLY arrives, confirmCustomMutation removes it normally.
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } }),
		);
		await expect(mutationPromise).resolves.toEqual({ ok: true });

		// After REPLY removes the optimistic mutation, the server broadcast record remains
		expect(client.store.query.posts.one('post-4').get()).toEqual(
			expect.objectContaining({ id: 'post-4', title: 'Still Optimistic' }),
		);

		client.client.ws.disconnect();
	});

	test('multiple optimistic mutations — broadcast only cleans up the matching one', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		// First optimistic insert
		client.store.mutate.posts.createPost({
			id: 'post-a',
			title: 'Post A',
			likes: 0,
		});
		const sentA = getLastSentMessage(ws);

		// Second optimistic insert
		client.store.mutate.posts.createPost({
			id: 'post-b',
			title: 'Post B',
			likes: 0,
		});

		expect(client.store.query.posts.one('post-a').get()).toBeDefined();
		expect(client.store.query.posts.one('post-b').get()).toBeDefined();

		// Broadcast for post-a with originMutationId matching first mutation
		ws.simulateMessage(
			makeBroadcast('srv-a', 'post-a', 'INSERT', { title: 'Post A', likes: 0 }, sentA.id),
		);

		// Both still visible: post-a from server, post-b still optimistic
		expect(client.store.query.posts.one('post-a').get()).toBeDefined();
		expect(client.store.query.posts.one('post-b').get()).toBeDefined();

		// REPLY for post-a — no-op since broadcast already cleaned it up.
		// Post-a record must survive (it's in rawObjPool from broadcast).
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentA.id, data: { ok: true } }),
		);

		expect(client.store.query.posts.one('post-a').get()).toEqual(
			expect.objectContaining({ id: 'post-a', title: 'Post A' }),
		);
		expect(client.store.query.posts.one('post-b').get()).toEqual(
			expect.objectContaining({ id: 'post-b', title: 'Post B' }),
		);

		client.client.ws.disconnect();
	});

	test('broadcast with different resourceId falls back to resource+procedure match (server-generated ID)', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		// Client creates an optimistic insert with client-generated ID
		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'client-id-1',
			title: 'Server Generates ID',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);

		expect(client.store.query.posts.one('client-id-1').get()).toEqual(
			expect.objectContaining({ id: 'client-id-1', title: 'Server Generates ID' }),
		);

		// Server creates its own ID (different from client's) — this is the real-world
		// scenario where the server handler does `const id = ulid(); db.insert({ id, ... })`
		ws.simulateMessage(
			makeBroadcast('srv-1', 'server-id-1', 'INSERT', { title: 'Server Generates ID', likes: 0 }, sentMessage.id),
		);

		// Optimistic mutation should be cleaned up via resource+procedure fallback
		// Server record now visible
		expect(client.store.query.posts.one('server-id-1').get()).toEqual(
			expect.objectContaining({ id: 'server-id-1', title: 'Server Generates ID' }),
		);
		// Client optimistic record is already gone (before REPLY)
		expect(client.store.query.posts.one('client-id-1').get()).toBeUndefined();

		// REPLY is a no-op — optimistic already gone
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } }),
		);

		await expect(mutationPromise).resolves.toEqual({ ok: true });

		// Server record survives
		expect(client.store.query.posts.one('server-id-1').get()).toEqual(
			expect.objectContaining({ id: 'server-id-1', title: 'Server Generates ID' }),
		);
		// Client optimistic record is gone
		expect(client.store.query.posts.one('client-id-1').get()).toBeUndefined();

		client.client.ws.disconnect();
	});

	test('resource+procedure fallback matches in order when multiple entries exist', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		// Two optimistic inserts from different custom mutations
		client.store.mutate.posts.createPost({
			id: 'client-a',
			title: 'First',
			likes: 0,
		});
		const sentA = getLastSentMessage(ws);

		client.store.mutate.posts.createPost({
			id: 'client-b',
			title: 'Second',
			likes: 0,
		});
		const sentB = getLastSentMessage(ws);

		// Broadcast for first mutation (server used different ID)
		ws.simulateMessage(
			makeBroadcast('srv-a', 'server-a', 'INSERT', { title: 'First', likes: 0 }, sentA.id),
		);

		// First optimistic cleaned up, second still present
		expect(client.store.query.posts.one('server-a').get()).toBeDefined();
		expect(client.store.query.posts.one('client-a').get()).toBeUndefined();
		expect(client.store.query.posts.one('client-b').get()).toBeDefined();

		// Broadcast for second mutation (server used different ID)
		ws.simulateMessage(
			makeBroadcast('srv-b', 'server-b', 'INSERT', { title: 'Second', likes: 0 }, sentB.id),
		);

		expect(client.store.query.posts.one('server-b').get()).toBeDefined();
		expect(client.store.query.posts.one('client-b').get()).toBeUndefined();

		client.client.ws.disconnect();
	});

	test('broadcast for different resource does not interfere with optimistic mutation', async () => {
		const { client, ws } = await createTestClient(makeOptimisticMutations());

		client.store.mutate.posts.createPost({
			id: 'post-mine',
			title: 'My Post',
			likes: 0,
		});

		expect(client.store.query.posts.one('post-mine').get()).toBeDefined();

		// Broadcast for a completely different record — no originMutationId
		ws.simulateMessage(
			makeBroadcast('srv-other', 'post-other', 'INSERT', { title: 'Other Post', likes: 0 }),
		);

		// My optimistic post is unaffected
		expect(client.store.query.posts.one('post-mine').get()).toEqual(
			expect.objectContaining({ id: 'post-mine', title: 'My Post' }),
		);
		// Other post is also visible
		expect(client.store.query.posts.one('post-other').get()).toEqual(
			expect.objectContaining({ id: 'post-other', title: 'Other Post' }),
		);

		client.client.ws.disconnect();
	});
});
