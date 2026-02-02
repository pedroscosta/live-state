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
				(cb) => cb !== callback
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
				failCreate: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<
						any,
						{ id: string; title: string; likes: number }
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

describe('custom optimistic mutations (websocket client)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.clearAllTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('applies optimistic operations and confirms on reply', async () => {
		const optimisticMutations = defineOptimisticMutations<TestRouter, typeof schema>({
			posts: {
				createPost: ({ input, storage }) => {
					storage.posts.insert({
						id: input.id,
						title: input.title,
						likes: input.likes,
					});
				},
			},
		});

		const { client, ws } = await createTestClient(optimisticMutations);
		const events: Array<{ type: string; [key: string]: any }> = [];
		const unsubscribe = client.client.addEventListener((event) => {
			events.push(event);
		});

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-1',
			title: 'Hello',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);
		expect(sentMessage).toEqual(
			expect.objectContaining({
				type: 'MUTATE',
				resource: 'posts',
				procedure: 'createPost',
			})
		);

		const optimisticApplied = events.find(
			(event) => event.type === 'OPTIMISTIC_MUTATION_APPLIED'
		);
		expect(optimisticApplied).toEqual(
			expect.objectContaining({
				type: 'OPTIMISTIC_MUTATION_APPLIED',
				resource: 'posts',
				resourceId: 'post-1',
				procedure: 'INSERT',
			})
		);
		expect(
			events.find(
				(event) =>
					event.type === 'MUTATION_SENT' && event.optimistic === true
			)
		).toBeDefined();

		const optimisticRecord = client.store.query.posts.one('post-1').get();
		expect(optimisticRecord).toEqual(
			expect.objectContaining({ id: 'post-1', title: 'Hello', likes: 0 })
		);

		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } })
		);

		await expect(mutationPromise).resolves.toEqual({ ok: true });
		expect(client.store.query.posts.one('post-1').get()).toBeDefined();

		unsubscribe();
		client.client.ws.disconnect();
	});

	test('skips optimistic flow when no handler is registered', async () => {
		const { client, ws } = await createTestClient();
		const events: Array<{ type: string; [key: string]: any }> = [];
		const unsubscribe = client.client.addEventListener((event) => {
			events.push(event);
		});

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-2',
			title: 'No handler',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);
		expect(sentMessage).toEqual(
			expect.objectContaining({
				type: 'MUTATE',
				resource: 'posts',
				procedure: 'createPost',
			})
		);

		expect(
			events.find(
				(event) =>
					event.type === 'MUTATION_SENT' && event.optimistic === false
			)
		).toBeDefined();
		expect(
			events.find((event) => event.type === 'OPTIMISTIC_MUTATION_APPLIED')
		).toBeUndefined();
		expect(client.store.query.posts.one('post-2').get()).toBeUndefined();

		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: { ok: true } })
		);
		await expect(mutationPromise).resolves.toEqual({ ok: true });

		unsubscribe();
		client.client.ws.disconnect();
	});

	test('rolls back optimistic mutations on timeout', async () => {
		const optimisticMutations = defineOptimisticMutations<TestRouter, typeof schema>({
			posts: {
				createPost: ({ input, storage }) => {
					storage.posts.insert({
						id: input.id,
						title: input.title,
						likes: input.likes,
					});
				},
			},
		});

		const { client } = await createTestClient(optimisticMutations);
		const events: Array<{ type: string; [key: string]: any }> = [];
		const unsubscribe = client.client.addEventListener((event) => {
			events.push(event);
		});

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-timeout',
			title: 'Timeout',
			likes: 0,
		});

		expect(client.store.query.posts.one('post-timeout').get()).toBeDefined();

		await vi.advanceTimersByTimeAsync(5000);

		await expect(mutationPromise).rejects.toThrow('Reply timeout');
		expect(client.store.query.posts.one('post-timeout').get()).toBeUndefined();
		expect(
			events.find((event) => event.type === 'OPTIMISTIC_MUTATION_UNDONE')
		).toBeDefined();

		unsubscribe();
		client.client.ws.disconnect();
	});

	test('rolls back when receives a reject reply', async () => {
		const optimisticMutations = defineOptimisticMutations<TestRouter, typeof schema>({
			posts: {
				createPost: ({ input, storage }) => {
					storage.posts.insert({
						id: input.id,
						title: input.title,
						likes: input.likes,
					});
				},
			},
		});

		const { client, ws } = await createTestClient(optimisticMutations);
		const events: Array<{ type: string; [key: string]: any }> = [];
		const unsubscribe = client.client.addEventListener((event) => {
			events.push(event);
		});

		const mutationPromise = client.store.mutate.posts.createPost({
			id: 'post-reject',
			title: 'Reject',
			likes: 0,
		});

		const sentMessage = getLastSentMessage(ws);
		expect(sentMessage).toEqual(
			expect.objectContaining({
				type: 'MUTATE',
				resource: 'posts',
				procedure: 'createPost',
			})
		);

		expect(client.store.query.posts.one('post-reject').get()).toBeDefined();

		ws.simulateMessage(
			JSON.stringify({
				type: 'REJECT',
				id: sentMessage.id,
				resource: 'posts',
				message: 'Nope',
			})
		);

		await expect(mutationPromise).rejects.toThrow('Nope');
		expect(client.store.query.posts.one('post-reject').get()).toBeUndefined();
		expect(
			events.find((event) => event.type === 'OPTIMISTIC_MUTATION_UNDONE')
		).toBeDefined();

		unsubscribe();
		client.client.ws.disconnect();
	});

test('fails safely when optimistic handler throws', async () => {
		const optimisticMutations = defineOptimisticMutations<TestRouter, typeof schema>({
			posts: {
				failCreate: () => {
					throw new Error('boom');
				},
			},
		});

		const { client, ws } = await createTestClient(optimisticMutations);
		const events: Array<{ type: string; [key: string]: any }> = [];
		const unsubscribe = client.client.addEventListener((event) => {
			events.push(event);
		});

		expect(() =>
			client.store.mutate.posts.failCreate({
				id: 'post-err',
				title: 'Boom',
				likes: 0,
			})
		).toThrow('boom');

		expect(ws.send).not.toHaveBeenCalled();
		expect(
			events.find((event) => event.type === 'OPTIMISTIC_MUTATION_APPLIED')
		).toBeUndefined();
		expect(
			events.find((event) => event.type === 'MUTATION_SENT')
		).toBeUndefined();

		unsubscribe();
		client.client.ws.disconnect();
	});
});
