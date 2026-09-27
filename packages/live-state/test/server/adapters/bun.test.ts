import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bunAdapter } from '../../../src/server';
import type {
	BunServer,
	BunServerWebSocket,
} from '../../../src/server/adapters/bun';
import type { AnyRouter } from '../../../src/server/router';
import type { Server } from '../../../src/server';

describe('bunAdapter', () => {
	let mockServer: Server<AnyRouter>;

	beforeEach(() => {
		mockServer = {
			contextProvider: vi.fn().mockResolvedValue({ userId: 'user123' }),
			handleCustomQuery: vi.fn(),
			handleMutation: vi.fn(),
			logger: {
				critical: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				info: vi.fn(),
				debug: vi.fn(),
			},
		} as unknown as Server<AnyRouter>;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	test('upgrades the WebSocket path and passes the request through Bun data', async () => {
		const upgrade = vi.fn().mockReturnValue(true);
		const adapter = bunAdapter(mockServer);
		const request = new Request('http://localhost:3000/ws?userId=user123', {
			headers: { cookie: 'sessionId=abc123' },
		});

		const response = await adapter.fetch(request, { upgrade } as BunServer);

		expect(response).toBeUndefined();

		expect(upgrade).toHaveBeenCalledWith(request, {
			data: { request },
		});
	});

	test('returns a bad request when Bun cannot upgrade the socket', async () => {
		const adapter = bunAdapter(mockServer);
		const response = await adapter.fetch(
			new Request('http://localhost:3000/ws'),
			{ upgrade: vi.fn().mockReturnValue(false) } as BunServer,
		);

		expect(response?.status).toBe(400);
		expect(await response?.text()).toBe('WebSocket upgrade failed');
	});

	test('handles Bun messages and cleans up subscriptions on close', async () => {
		const unsubscribe = vi.fn();
		(mockServer.handleCustomQuery as ReturnType<typeof vi.fn>).mockResolvedValue(
			{
				data: [
					{
						value: { id: { value: 'user1' }, name: { value: 'John' } },
					},
				],
				query: { resource: 'users' },
				unsubscribe,
			},
		);

		const upgrade = vi.fn().mockReturnValue(true);
		const adapter = bunAdapter(mockServer, { basePath: '/api/' });
		const request = new Request(
			'http://localhost:3000/api/ws?userId=user123',
			{
				headers: { cookie: 'sessionId=abc123' },
			},
		);

		await adapter.fetch(request, { upgrade } as BunServer);
		const data = upgrade.mock.calls[0]?.[1]?.data;
		const send = vi.fn();
		const socket = { data, send } as unknown as BunServerWebSocket;

		await adapter.websocket.open(socket);
		await adapter.websocket.message(
			socket,
			new TextEncoder().encode(
				JSON.stringify({
					type: 'SUBSCRIBE',
					resource: 'users',
					procedure: 'list',
					id: 'subscription-1',
				}),
			),
		);

		expect(mockServer.handleCustomQuery).toHaveBeenCalledWith(
			expect.objectContaining({
				req: expect.objectContaining({
					headers: expect.objectContaining({ cookie: 'sessionId=abc123' }),
					cookies: { sessionId: 'abc123' },
					queryParams: { userId: 'user123' },
					context: { userId: 'user123' },
				}),
				subscription: expect.any(Function),
			}),
		);
		expect(send).toHaveBeenCalledWith(
			JSON.stringify({
				id: 'subscription-1',
				type: 'REPLY',
				data: {
					resource: 'users',
					data: [{ id: { value: 'user1' }, name: { value: 'John' } }],
				},
			}),
		);

		const subscription = (mockServer.handleCustomQuery as ReturnType<typeof vi.fn>)
			.mock.calls[0]?.[0]?.subscription;
		subscription({
			type: 'SYNC',
			resource: 'users',
			resourceId: 'user1',
			op: 'UPDATE',
			id: 'mutation-1',
			payload: { name: { value: 'Jane' } },
		});
		expect(send).toHaveBeenCalledTimes(2);

		await adapter.websocket.close(socket, 1000, 'done');
		expect(unsubscribe).toHaveBeenCalledOnce();

		subscription({
			type: 'SYNC',
			resource: 'users',
			resourceId: 'user1',
			op: 'UPDATE',
			id: 'mutation-2',
			payload: { name: { value: 'Mary' } },
		});
		expect(send).toHaveBeenCalledTimes(2);
	});

	test('uses the standard Request handler for non-WebSocket paths', async () => {
		(mockServer.handleCustomQuery as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ id: 'user1' },
		]);
		const adapter = bunAdapter(mockServer);

		const response = await adapter.fetch(
			new Request('http://localhost:3000/users/query/list', {
				method: 'POST',
				body: JSON.stringify({ input: {} }),
			}),
			{ upgrade: vi.fn() } as BunServer,
		);

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual([{ id: 'user1' }]);
	});
});
