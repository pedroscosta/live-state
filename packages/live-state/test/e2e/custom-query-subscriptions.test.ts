import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, type Selectable } from 'kysely';
import express from 'express';
import expressWs from 'express-ws';
import { z } from 'zod';
import type { Server as HttpServer } from 'http';
import {
	createSchema,
	id,
	object,
	string,
} from '../../src/schema';
import {
	expressAdapter,
	routeFactory,
	router,
	server,
} from '../../src/server';
import { SQLStorage } from '../../src/server/storage';
import { generateId } from '../../src/core/utils';
import { createClient } from '../../src/client';
import { LogLevel } from '../../src/utils';

const user = object('users', {
	id: id(),
	name: string(),
	email: string(),
});

const testSchema = createSchema({
	users: user,
});

const publicRoute = routeFactory();

const testRouter = router({
	schema: testSchema,
	routes: {
		users: publicRoute
			.collectionRoute(testSchema.users)
			.withProcedures(({ query }) => ({
				usersByIds: query(
					z.object({
						ids: z.array(z.string()),
					}),
				).handler(async ({ req, db }) => {
					return db.users.where({ id: { $in: req.input.ids } });
				}),
			})),
	},
});

describe('Custom Query Subscriptions End-to-End Tests', () => {
	let storage: SQLStorage;
	let testServer: ReturnType<typeof server>;
	let db: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<unknown> }>;
	let httpServer: HttpServer | null = null;
	let serverPort: number;
	let wsClient: ReturnType<typeof createClient<typeof testRouter>>;

	const waitForConnection = (client: ReturnType<typeof createClient>) => {
		return new Promise<void>((resolve) => {
			if (client.client.ws.connected()) {
				resolve();
				return;
			}

			const listener = () => {
				if (client.client.ws.connected()) {
					client.client.ws.removeEventListener('connectionChange', listener);
					resolve();
				}
			};

			client.client.ws.addEventListener('connectionChange', listener);
		});
	};

	const waitForReply = (
		client: ReturnType<typeof createClient>,
		requestId: string,
	) => {
		return new Promise<any>((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				client.client.ws.removeEventListener('message', handleMessage);
				reject(new Error('Reply timeout'));
			}, 2000);

			const handleMessage = (event: MessageEvent) => {
				const rawData =
					typeof event.data === 'string'
						? event.data
						: event.data.toString();
				const payload = JSON.parse(rawData);
				if (payload.type === 'REPLY' && payload.id === requestId) {
					clearTimeout(timeoutHandle);
					client.client.ws.removeEventListener('message', handleMessage);
					resolve(payload);
				}
			};

			client.client.ws.addEventListener('message', handleMessage);
		});
	};

	beforeEach(async () => {
		db = new Database(':memory:');
		db.pragma('foreign_keys = ON');

		kyselyDb = new Kysely({
			dialect: new SqliteDialect({
				database: db,
			}),
		});

		storage = new SQLStorage(kyselyDb, testSchema);
		await storage.init(testSchema);

		testServer = server({
			router: testRouter,
			storage,
			schema: testSchema,
			logLevel: LogLevel.DEBUG,
		});

		const { app } = expressWs(express());
		app.use(express.json());
		app.use(express.urlencoded({ extended: true }));
		expressAdapter(app, testServer);

		serverPort = await new Promise<number>((resolve) => {
			httpServer = app.listen(0, () => {
				const address = httpServer?.address();
				const port =
					typeof address === 'object' && address?.port ? address.port : 0;
				resolve(port);
			});
		});

		wsClient = createClient({
			url: `ws://localhost:${serverPort}/ws`,
			schema: testSchema,
			storage: false,
			logLevel: LogLevel.DEBUG,
		});

		await waitForConnection(wsClient);
	});

	afterEach(async () => {
		if (wsClient?.client?.ws) {
			wsClient.client.ws.disconnect();
		}

		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
			httpServer = null;
		}

		if (kyselyDb) {
			await kyselyDb.schema.dropTable('users_meta').ifExists().execute();
			await kyselyDb.schema.dropTable('users').ifExists().execute();
		}

		if (db) {
			db.close();
		}
	});

	test('should execute custom query via QUERY message', async () => {
		const userId = generateId();
		await storage.insert(testSchema.users, {
			id: userId,
			name: 'User One',
			email: 'user1@example.com',
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		const requestId = generateId();
		const replyPromise = waitForReply(wsClient, requestId);

		wsClient.client.ws.send(
			JSON.stringify({
				id: requestId,
				type: 'QUERY',
				resource: 'users',
				procedure: 'usersByIds',
				input: { ids: [userId] },
			}),
		);

		const reply = await replyPromise;
		expect(Array.isArray(reply.data)).toBe(true);
		expect(reply.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: userId,
					name: 'User One',
				}),
			]),
		);
	});

	test('should load and update data via custom query subscription', async () => {
		const userId = generateId();
		await storage.insert(testSchema.users, {
			id: userId,
			name: 'Initial User',
			email: 'initial@example.com',
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		const customQuery = wsClient.store.query.users.usersByIds({
			ids: [userId],
		});

		const unsubscribe = wsClient.client.load(customQuery.buildQueryRequest());

		await new Promise((resolve) => setTimeout(resolve, 200));

		const initialResult = await wsClient.store.query.users
			.where({ id: { $in: [userId] } })
			.get();
		expect(initialResult).toHaveLength(1);
		expect(initialResult[0].name).toBe('Initial User');

		await storage.update(testSchema.users, userId, {
			name: 'Updated User',
		});

		await new Promise((resolve) => setTimeout(resolve, 200));

		const updatedResult = await wsClient.store.query.users
			.where({ id: { $in: [userId] } })
			.get();
		expect(updatedResult).toHaveLength(1);
		expect(updatedResult[0].name).toBe('Updated User');

		unsubscribe();

		await new Promise((resolve) => setTimeout(resolve, 200));

		await storage.update(testSchema.users, userId, {
			name: 'Updated After Unsubscribe',
		});

		await new Promise((resolve) => setTimeout(resolve, 200));

		const unsubscribedResult = await wsClient.store.query.users
			.where({ id: { $in: [userId] } })
			.get();
		expect(unsubscribedResult).toHaveLength(1);
		expect(unsubscribedResult[0].name).toBe('Updated User');
	});
});
