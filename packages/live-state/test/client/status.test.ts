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

	simulateMessage(data: any): void {
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

const makeClient = async () => {
	const client = createClient<TestRouter>({
		url: 'ws://localhost:1234',
		schema,
		storage: false,
		connection: { autoConnect: false, autoReconnect: false },
	});
	await client.client.ws.connect();
	const ws = (client.client.ws as any).ws as MockWebSocket;
	ws.simulateOpen();
	return { client, ws };
};

const syncReply = (resource: string, data: any[] = []) =>
	JSON.stringify({
		type: 'REPLY',
		id: `reply-${Math.random()}`,
		data: { resource, data },
	});

describe('client bootstrap status', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.clearAllTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('with storage: false, starts pending and goes straight to remote on first sync REPLY', async () => {
		const { client, ws } = await makeClient();

		expect(client.client.bootstrapStatus).toBe('pending');

		const events: ClientEvents[] = [];
		client.client.addEventListener((e) => events.push(e));

		ws.simulateMessage(syncReply('posts', []));

		expect(client.client.bootstrapStatus).toBe('remote');
		const statusEvents = events.filter((e) => e.type === 'BOOTSTRAP_STATUS_CHANGE');
		expect(statusEvents).toEqual([
			{ type: 'BOOTSTRAP_STATUS_CHANGE', bootstrapStatus: 'remote' },
		]);

		client.client.ws.disconnect();
	});

	test('subsequent sync REPLYs do not emit further STATUS_CHANGE events', async () => {
		const { client, ws } = await makeClient();

		const events: ClientEvents[] = [];
		client.client.addEventListener((e) => events.push(e));

		ws.simulateMessage(syncReply('posts', []));
		ws.simulateMessage(syncReply('posts', []));
		ws.simulateMessage(syncReply('posts', []));

		const statusEvents = events.filter((e) => e.type === 'BOOTSTRAP_STATUS_CHANGE');
		expect(statusEvents).toHaveLength(1);
		expect(client.client.bootstrapStatus).toBe('remote');

		client.client.ws.disconnect();
	});

	test('custom-query REPLY (matched by replyHandlers) does not advance status', async () => {
		const { client, ws } = await makeClient();

		expect(client.client.bootstrapStatus).toBe('pending');

		// Issue a custom query so its id is registered in replyHandlers.
		// CustomQueryCall is PromiseLike — .then() triggers the actual send.
		const queryPromise = (client.store.query.posts as any)
			.somePostsQuery({})
			.then((v: any) => v);

		const sentRaw = ws.send.mock.calls.at(-1)?.[0];
		expect(sentRaw).toBeDefined();
		const sent = JSON.parse(sentRaw as string);
		expect(sent.type).toBe('CUSTOM_QUERY');

		ws.simulateMessage(
			JSON.stringify({ type: 'REPLY', id: sent.id, data: { ok: true } }),
		);

		await expect(queryPromise).resolves.toEqual({ ok: true });

		// Custom-query REPLY took the replyHandlers branch and returned early —
		// status must remain pending.
		expect(client.client.bootstrapStatus).toBe('pending');

		client.client.ws.disconnect();
	});
});
