import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	type ClientEvents,
	createClient,
} from '../../src/client/websocket/client';
import { createSchema, id, object, string } from '../../src/schema';

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.CLOSED;
	eventListeners: Record<string, Array<(event: any) => void>> = {};

	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = MockWebSocket.CLOSED;
		this.dispatchEvent(new CloseEvent('close'));
	});

	constructor(public url: string) {
		this.readyState = MockWebSocket.CONNECTING;
	}

	addEventListener(event: string, callback: (event: any) => void): void {
		(this.eventListeners[event] ??= []).push(callback);
	}

	removeEventListener(event: string, callback: (event: any) => void): void {
		this.eventListeners[event] = (this.eventListeners[event] ?? []).filter(
			(cb) => cb !== callback,
		);
	}

	dispatchEvent(event: Event): boolean {
		(this.eventListeners[event.type] ?? []).forEach((listener) =>
			listener(event),
		);
		return true;
	}

	simulateOpen(): void {
		this.readyState = MockWebSocket.OPEN;
		this.dispatchEvent(new Event('open'));
	}

	simulateMessage(data: unknown): void {
		this.dispatchEvent(new MessageEvent('message', { data }));
	}
}

vi.stubGlobal('WebSocket', MockWebSocket);

const posts = object('posts', {
	id: id(),
	title: string(),
});

const schema = createSchema({ posts });

type TestRouter = {
	routes: {
		posts: {
			resourceSchema: typeof posts;
			customMutations: {};
			customQueries: {};
		};
	};
};

const connectClient = async (opts: Record<string, unknown> = {}) => {
	const client = createClient<TestRouter>({
		url: 'ws://localhost:1234',
		schema,
		storage: false,
		connection: { autoConnect: false, autoReconnect: false },
		...opts,
	});
	await client.client.ws.connect();
	const ws = (client.client.ws as any).ws as MockWebSocket;
	ws.simulateOpen();
	return { client, ws };
};

describe('client outbound message events', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.clearAllTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('emits MESSAGE_SENT for every outbound protocol frame', async () => {
		const { client, ws } = await connectClient();
		const events: ClientEvents[] = [];
		const unsubscribe = client.client.addEventListener((event) =>
			events.push(event),
		);

		const unsubscribeQuery = client.client.load({
			resource: 'posts',
			procedure: 'list',
			input: {},
		});
		const queryPromise = (client.store.query.posts as any)
			.somePostsQuery({})
			.then((value: unknown) => value);
		const mutationPromise = (client.store.mutate as any).posts.createPost({
			id: 'post-1',
			title: 'Hello',
		});
		unsubscribeQuery();

		const sentMessages = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
		const sentEvents = events.filter(
			(event): event is Extract<ClientEvents, { type: 'MESSAGE_SENT' }> =>
				event.type === 'MESSAGE_SENT',
		);

		expect(sentEvents).toEqual(
			sentMessages.map((message: unknown) => ({
				type: 'MESSAGE_SENT',
				message,
			})),
		);

		for (const message of sentMessages) {
			if (message.type === 'CUSTOM_QUERY' || message.type === 'MUTATE') {
				ws.simulateMessage(
					JSON.stringify({ type: 'REPLY', id: message.id, data: {} }),
				);
			}
		}

		await expect(queryPromise).resolves.toEqual({});
		await expect(mutationPromise).resolves.toEqual({});
		unsubscribe();
		client.client.ws.disconnect();
	});

	test('emits MESSAGE_SENT when an offline mutation is replayed', async () => {
		const client = createClient<TestRouter>({
			url: 'ws://localhost:1234',
			schema,
			storage: false,
			optimisticMutations: {
				getHandler: () => ({ input, storage }: any) => {
					storage.posts.insert(input);
				},
			} as any,
			connection: { autoConnect: false, autoReconnect: false },
		});
		const events: ClientEvents[] = [];
		const unsubscribe = client.client.addEventListener((event) =>
			events.push(event),
		);

		await (client.store.mutate as any).posts.createPost({
			id: 'offline-post',
			title: 'Offline',
		});
		expect(events.filter((event) => event.type === 'MESSAGE_SENT')).toHaveLength(
			0,
		);

		await client.client.ws.connect();
		const ws = (client.client.ws as any).ws as MockWebSocket;
		ws.simulateOpen();

		const sentEvents = events.filter(
			(event): event is Extract<ClientEvents, { type: 'MESSAGE_SENT' }> =>
				event.type === 'MESSAGE_SENT',
		);
		expect(sentEvents).toHaveLength(1);
		expect(sentEvents[0]).toEqual({
			type: 'MESSAGE_SENT',
			message: expect.objectContaining({
				type: 'MUTATE',
				id: expect.any(String),
				resource: 'posts',
				procedure: 'createPost',
			}),
		});

		const sentMessage = JSON.parse(ws.send.mock.calls[0][0]);
		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sentMessage.id, data: {} }),
		);
		unsubscribe();
		client.client.ws.disconnect();
	});
});
