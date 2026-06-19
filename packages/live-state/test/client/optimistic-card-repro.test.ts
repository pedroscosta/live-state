import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineOptimisticMutations } from '../../src/client/optimistic';
import { createClient } from '../../src/client/websocket/client';
import { schema } from '../_utils/schema';

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

type TestRouter = {
	routes: {
		groups: {
			resourceSchema: (typeof schema)['groups'];
			customMutations: {
				createGroup: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<any, { id: string; name: string }>;
					handler: () => void;
				};
				listGroups: {
					_type: 'query';
					inputValidator: StandardSchemaV1<any, void>;
					handler: () => void;
				};
			};
			customQueries: {};
		};
		cards: {
			resourceSchema: (typeof schema)['cards'];
			customMutations: {
				createCard: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<
						any,
						{ id: string; name: string; groupId: string }
					>;
					handler: () => void;
				};
			};
			customQueries: {};
		};
	};
};

const optimisticMutations = defineOptimisticMutations<TestRouter, typeof schema>({
	groups: {
		createGroup: ({ input, storage }) => {
			storage.groups.insert({ id: input.id, name: input.name });
		},
	},
	cards: {
		createCard: ({ input, storage }) => {
			storage.cards.insert({
				id: input.id,
				name: input.name,
				counter: 0,
				groupId: input.groupId,
			});
		},
	},
});

describe('optimistic createCard with group include (storefront repro)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('card appears in parent group include after optimistic createCard', async () => {
		const client = createClient<TestRouter>({
			url: 'ws://localhost:1234',
			schema,
			storage: false,
			optimisticMutations,
			connection: { autoConnect: false, autoReconnect: false },
		});

		await client.client.ws.connect();
		const ws = (client.client.ws as any).ws as MockWebSocket;
		ws.simulateOpen();

		const groupId = 'group-1';
		const existingCardId = 'card-existing';

		ws.simulateMessage(
			JSON.stringify({
				id: 'sub-1',
				type: 'REPLY',
				data: {
					resource: 'groups',
					data: [
						{
							id: { value: groupId, _meta: { timestamp: '2026-01-01' } },
							name: { value: 'Group 1', _meta: { timestamp: '2026-01-01' } },
							cards: {
								value: [
									{
										value: {
											id: {
												value: existingCardId,
												_meta: { timestamp: '2026-01-01' },
											},
											name: {
												value: 'Existing',
												_meta: { timestamp: '2026-01-01' },
											},
											counter: {
												value: 0,
												_meta: { timestamp: '2026-01-01' },
											},
											groupId: {
												value: groupId,
												_meta: { timestamp: '2026-01-01' },
											},
										},
									},
								],
							},
						},
					],
				},
			}),
		);

		const before = client.store.query.groups
			.one(groupId)
			.include({ cards: true })
			.get();

		const newCardId = 'card-new';
		let mutationError: unknown;
		try {
			client.store.mutate.cards.createCard({
				id: newCardId,
				name: 'New Card',
				groupId,
			});
		} catch (e) {
			mutationError = e;
		}

		const after = client.store.query.groups
			.one(groupId)
			.include({ cards: true })
			.get();

		const cardDirect = client.store.query.cards.one(newCardId).get();

		expect(mutationError).toBeUndefined();
		expect(cardDirect).toEqual(
			expect.objectContaining({ id: newCardId, name: 'New Card' }),
		);
		expect(after?.cards).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: newCardId }),
				expect.objectContaining({ id: existingCardId }),
			]),
		);

		client.client.ws.disconnect();
	});

	test('card persists in group include after server reply and broadcast', async () => {
		const client = createClient<TestRouter>({
			url: 'ws://localhost:1234',
			schema,
			storage: false,
			optimisticMutations,
			connection: { autoConnect: false, autoReconnect: false },
		});

		await client.client.ws.connect();
		const ws = (client.client.ws as any).ws as MockWebSocket;
		ws.simulateOpen();

		const groupId = 'group-1';
		const newCardId = 'card-new';

		ws.simulateMessage(
			JSON.stringify({
				id: 'sub-1',
				type: 'REPLY',
				data: {
					resource: 'groups',
					data: [
						{
							id: { value: groupId, _meta: { timestamp: '2026-01-01' } },
							name: { value: 'Group 1', _meta: { timestamp: '2026-01-01' } },
							cards: { value: [] },
						},
					],
				},
			}),
		);

		const mutationPromise = client.store.mutate.cards.createCard({
			id: newCardId,
			name: 'New Card',
			groupId,
		});

		const sentMessage = JSON.parse(ws.send.mock.calls.at(-1)?.[0] as string);

		const afterOptimistic = client.store.query.groups
			.one(groupId)
			.include({ cards: true })
			.get();

		ws.simulateMessage(
			JSON.stringify({
				id: sentMessage.id,
				type: 'REPLY',
				data: { id: newCardId },
			}),
		);

		ws.simulateMessage(
			JSON.stringify({
				id: 'broadcast-1',
				type: 'SYNC',
				resource: 'cards',
				resourceId: newCardId,
				op: 'INSERT',
				meta: { originMutationId: sentMessage.id },
				payload: {
					name: { value: 'New Card', _meta: { timestamp: '2026-01-01' } },
					counter: { value: 0, _meta: { timestamp: '2026-01-01' } },
					groupId: { value: groupId, _meta: { timestamp: '2026-01-01' } },
				},
			}),
		);

		await mutationPromise;

		const afterConfirm = client.store.query.groups
			.one(groupId)
			.include({ cards: true })
			.get();

		const cardDirect = client.store.query.cards.one(newCardId).get();

		expect(afterOptimistic?.cards).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: newCardId })]),
		);
		expect(afterConfirm?.cards).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: newCardId })]),
		);
		expect(cardDirect).toEqual(
			expect.objectContaining({ id: newCardId, name: 'New Card' }),
		);

		client.client.ws.disconnect();
	});

	test('card persists when broadcast arrives before reply', async () => {
		const client = createClient<TestRouter>({
			url: 'ws://localhost:1234',
			schema,
			storage: false,
			optimisticMutations,
			connection: { autoConnect: false, autoReconnect: false },
		});

		await client.client.ws.connect();
		const ws = (client.client.ws as any).ws as MockWebSocket;
		ws.simulateOpen();

		const groupId = 'group-1';
		const newCardId = 'card-new';

		ws.simulateMessage(
			JSON.stringify({
				id: 'sub-1',
				type: 'REPLY',
				data: {
					resource: 'groups',
					data: [
						{
							id: { value: groupId, _meta: { timestamp: '2026-01-01' } },
							name: { value: 'Group 1', _meta: { timestamp: '2026-01-01' } },
							cards: { value: [] },
						},
					],
				},
			}),
		);

		const mutationPromise = client.store.mutate.cards.createCard({
			id: newCardId,
			name: 'New Card',
			groupId,
		});

		const sentMessage = JSON.parse(ws.send.mock.calls.at(-1)?.[0] as string);

		ws.simulateMessage(
			JSON.stringify({
				id: 'broadcast-1',
				type: 'SYNC',
				resource: 'cards',
				resourceId: newCardId,
				op: 'INSERT',
				meta: { originMutationId: sentMessage.id },
				payload: {
					name: { value: 'New Card', _meta: { timestamp: '2026-01-01' } },
					counter: { value: 0, _meta: { timestamp: '2026-01-01' } },
					groupId: { value: groupId, _meta: { timestamp: '2026-01-01' } },
				},
			}),
		);

		ws.simulateMessage(
			JSON.stringify({
				id: sentMessage.id,
				type: 'REPLY',
				data: { id: newCardId },
			}),
		);

		await mutationPromise;

		const after = client.store.query.groups
			.one(groupId)
			.include({ cards: true })
			.get();
		const cardDirect = client.store.query.cards.one(newCardId).get();

		expect(after?.cards).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: newCardId })]),
		);

		client.client.ws.disconnect();
	});

	test('card disappears if reply confirms but broadcast never arrives', async () => {
		const client = createClient<TestRouter>({
			url: 'ws://localhost:1234',
			schema,
			storage: false,
			optimisticMutations,
			connection: { autoConnect: false, autoReconnect: false },
		});

		await client.client.ws.connect();
		const ws = (client.client.ws as any).ws as MockWebSocket;
		ws.simulateOpen();

		const groupId = 'group-1';
		const newCardId = 'card-new';

		ws.simulateMessage(
			JSON.stringify({
				id: 'sub-1',
				type: 'REPLY',
				data: {
					resource: 'groups',
					data: [
						{
							id: { value: groupId, _meta: { timestamp: '2026-01-01' } },
							name: { value: 'Group 1', _meta: { timestamp: '2026-01-01' } },
							cards: { value: [] },
						},
					],
				},
			}),
		);

		const mutationPromise = client.store.mutate.cards.createCard({
			id: newCardId,
			name: 'New Card',
			groupId,
		});

		const sentMessage = JSON.parse(ws.send.mock.calls.at(-1)?.[0] as string);

		ws.simulateMessage(
			JSON.stringify({
				id: sentMessage.id,
				type: 'REPLY',
				data: { id: newCardId },
			}),
		);

		await mutationPromise;

		const after = client.store.query.groups
			.one(groupId)
			.include({ cards: true })
			.get();

		expect(after?.cards ?? []).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: newCardId })]),
		);

		client.client.ws.disconnect();
	});
});
