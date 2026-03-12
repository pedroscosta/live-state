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
	createRelations,
	id,
	number,
	object,
	reference,
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
import { createClient as createFetchClient } from '../../src/client/fetch';
import { LogLevel } from '../../src/utils';

const user = object('users', {
	id: id(),
	name: string(),
	email: string(),
});

const post = object('posts', {
	id: id(),
	title: string(),
	content: string(),
	authorId: reference('users.id'),
	likes: number(),
});

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, 'authorId'),
}));

const postRelations = createRelations(post, ({ one }) => ({
	author: one(user, 'authorId'),
}));

const testSchema = createSchema({
	users: user,
	posts: post,
	userRelations,
	postRelations,
});

const publicRoute = routeFactory();

const testRouter = router({
	schema: testSchema,
	routes: {
		users: publicRoute.collectionRoute(testSchema.users),
		posts: publicRoute
			.collectionRoute(testSchema.posts)
			.withProcedures(({ query }) => ({
				paginatedPosts: query(
					z.object({
						cursor: z.number().optional(),
						pageSize: z.number(),
					}),
				).handler(async ({ req, db }) => {
					const { cursor, pageSize } = req.input;

					let posts;
					if (cursor !== undefined) {
						posts = await db.posts
							.where({ likes: { $gt: cursor } })
							.orderBy('likes', 'asc')
							.limit(pageSize + 1)
							.get();
					} else {
						posts = await db.posts
							.orderBy('likes', 'asc')
							.limit(pageSize + 1)
							.get();
					}

					const hasMore = posts.length > pageSize;
					const data = hasMore ? posts.slice(0, pageSize) : posts;
					const nextCursor =
						data.length > 0 ? data[data.length - 1].likes : null;

					return { data, nextCursor, hasMore };
				}),
			})),
	},
});

describe('Cursor-Based Pagination End-to-End Tests', () => {
	let storage: SQLStorage;
	let testServer: ReturnType<typeof server>;
	let db: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;
	let httpServer: HttpServer | null = null;
	let serverPort: number;
	let wsClient: ReturnType<typeof createClient<typeof testRouter>>;
	let fetchClient: ReturnType<typeof createFetchClient<typeof testRouter>>;
	let authorId: string;

	const waitForConnection = (client: ReturnType<typeof createClient>) => {
		return new Promise<void>((resolve) => {
			if (client.client.ws.connected()) {
				resolve();
				return;
			}

			const listener = () => {
				if (client.client.ws.connected()) {
					client.client.ws.removeEventListener(
						'connectionChange',
						listener,
					);
					resolve();
				}
			};

			client.client.ws.addEventListener('connectionChange', listener);
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
					typeof address === 'object' && address?.port
						? address.port
						: 0;
				resolve(port);
			});
		});

		// Create a shared author for posts
		authorId = generateId();
		await storage.insert(testSchema.users, {
			id: authorId,
			name: 'Test Author',
			email: 'author@example.com',
		});

		wsClient = createClient({
			url: `ws://localhost:${serverPort}/ws`,
			schema: testSchema,
			storage: false,
			connection: {
				autoConnect: true,
				autoReconnect: false,
			},
		});

		await wsClient.client.load(
			wsClient.store.query.posts.buildQueryRequest(),
		);
		await waitForConnection(wsClient);

		fetchClient = createFetchClient({
			url: `http://localhost:${serverPort}`,
			schema: testSchema,
		});
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
			try {
				await kyselyDb.schema
					.dropTable('posts_meta')
					.ifExists()
					.execute();
				await kyselyDb.schema.dropTable('posts').ifExists().execute();
				await kyselyDb.schema
					.dropTable('users_meta')
					.ifExists()
					.execute();
				await kyselyDb.schema.dropTable('users').ifExists().execute();
			} catch (_error) {
				// Ignore errors during cleanup
			}
		}

		if (db) {
			db.close();
		}
	});

	const insertPosts = async (likesValues: number[]) => {
		for (const likes of likesValues) {
			await storage.insert(testSchema.posts, {
				id: generateId(),
				title: `Post with ${likes} likes`,
				content: `Content for post with ${likes} likes`,
				authorId,
				likes,
			});
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	};

	describe('Fetch Client - Default Query Pagination', () => {
		test('should paginate through posts using orderBy, limit, and where $gt', async () => {
			await insertPosts([1, 2, 3, 4, 5]);

			// Page 1: first 2 posts ordered by likes
			const page1 = await fetchClient.query.posts
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page1).toHaveLength(2);
			expect(page1[0].likes).toBe(1);
			expect(page1[1].likes).toBe(2);

			// Page 2: next 2 posts after cursor (likes > 2)
			const page2 = await fetchClient.query.posts
				.where({ likes: { $gt: 2 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page2).toHaveLength(2);
			expect(page2[0].likes).toBe(3);
			expect(page2[1].likes).toBe(4);

			// Page 3: remaining posts after cursor (likes > 4)
			const page3 = await fetchClient.query.posts
				.where({ likes: { $gt: 4 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page3).toHaveLength(1);
			expect(page3[0].likes).toBe(5);

			// Page 4: no more posts (likes > 5)
			const page4 = await fetchClient.query.posts
				.where({ likes: { $gt: 5 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page4).toHaveLength(0);
		});

		test('should paginate in descending order', async () => {
			await insertPosts([1, 2, 3, 4, 5]);

			const page1 = await fetchClient.query.posts
				.orderBy('likes', 'desc')
				.limit(2)
				.get();

			expect(page1).toHaveLength(2);
			expect(page1[0].likes).toBe(5);
			expect(page1[1].likes).toBe(4);

			const page2 = await fetchClient.query.posts
				.where({ likes: { $lt: 4 } })
				.orderBy('likes', 'desc')
				.limit(2)
				.get();

			expect(page2).toHaveLength(2);
			expect(page2[0].likes).toBe(3);
			expect(page2[1].likes).toBe(2);

			const page3 = await fetchClient.query.posts
				.where({ likes: { $lt: 2 } })
				.orderBy('likes', 'desc')
				.limit(2)
				.get();

			expect(page3).toHaveLength(1);
			expect(page3[0].likes).toBe(1);
		});
	});

	describe('WebSocket Client - Default Query Pagination', () => {
		test('should paginate through posts using orderBy, limit, and where $gt', async () => {
			await insertPosts([1, 2, 3, 4, 5]);

			// Wait for WS client to sync
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Page 1
			const page1 = wsClient.store.query.posts
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page1).toHaveLength(2);
			expect(page1[0].likes).toBe(1);
			expect(page1[1].likes).toBe(2);

			// Page 2
			const page2 = wsClient.store.query.posts
				.where({ likes: { $gt: 2 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page2).toHaveLength(2);
			expect(page2[0].likes).toBe(3);
			expect(page2[1].likes).toBe(4);

			// Page 3
			const page3 = wsClient.store.query.posts
				.where({ likes: { $gt: 4 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page3).toHaveLength(1);
			expect(page3[0].likes).toBe(5);

			// Empty page
			const page4 = wsClient.store.query.posts
				.where({ likes: { $gt: 5 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page4).toHaveLength(0);
		});

		test('should paginate in descending order', async () => {
			await insertPosts([1, 2, 3, 4, 5]);
			await new Promise((resolve) => setTimeout(resolve, 200));

			const page1 = wsClient.store.query.posts
				.orderBy('likes', 'desc')
				.limit(2)
				.get();

			expect(page1).toHaveLength(2);
			expect(page1[0].likes).toBe(5);
			expect(page1[1].likes).toBe(4);

			const page2 = wsClient.store.query.posts
				.where({ likes: { $lt: 4 } })
				.orderBy('likes', 'desc')
				.limit(2)
				.get();

			expect(page2).toHaveLength(2);
			expect(page2[0].likes).toBe(3);
			expect(page2[1].likes).toBe(2);
		});
	});

	describe('Fetch Client - Custom Query Pagination', () => {
		test('should paginate through all posts using custom paginatedPosts query', async () => {
			await insertPosts([10, 20, 30, 40, 50]);

			const allData: any[] = [];
			let cursor: number | undefined;
			let hasMore = true;

			while (hasMore) {
				const result = await fetchClient.query.posts.paginatedPosts({
					cursor,
					pageSize: 2,
				});

				expect(result).toBeDefined();
				expect(Array.isArray(result.data)).toBe(true);
				allData.push(...result.data);

				hasMore = result.hasMore;
				if (hasMore) {
					expect(result.nextCursor).toBeDefined();
					cursor = result.nextCursor!;
				}
			}

			expect(allData).toHaveLength(5);
			expect(allData.map((p: any) => p.likes)).toEqual([
				10, 20, 30, 40, 50,
			]);
		});

		test('should return correct hasMore and nextCursor values', async () => {
			await insertPosts([5, 10, 15]);

			// Page 1: 2 items, has more
			const page1 = await fetchClient.query.posts.paginatedPosts({
				pageSize: 2,
			});
			expect(page1.data).toHaveLength(2);
			expect(page1.hasMore).toBe(true);
			expect(page1.nextCursor).toBe(10);

			// Page 2: 1 item, no more
			const page2 = await fetchClient.query.posts.paginatedPosts({
				cursor: page1.nextCursor!,
				pageSize: 2,
			});
			expect(page2.data).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
			expect(page2.data[0].likes).toBe(15);
		});
	});

	describe('WebSocket Client - Custom Query Pagination', () => {
		test('should paginate via custom query over websocket', async () => {
			await insertPosts([10, 20, 30, 40, 50]);
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Page 1
			const page1 = await wsClient.store.query.posts.paginatedPosts({
				pageSize: 2,
			});

			expect(page1.data).toHaveLength(2);
			expect(page1.hasMore).toBe(true);
			expect(page1.data[0].likes).toBe(10);
			expect(page1.data[1].likes).toBe(20);

			// Page 2
			const page2 = await wsClient.store.query.posts.paginatedPosts({
				cursor: page1.nextCursor!,
				pageSize: 2,
			});

			expect(page2.data).toHaveLength(2);
			expect(page2.hasMore).toBe(true);
			expect(page2.data[0].likes).toBe(30);
			expect(page2.data[1].likes).toBe(40);

			// Page 3
			const page3 = await wsClient.store.query.posts.paginatedPosts({
				cursor: page2.nextCursor!,
				pageSize: 2,
			});

			expect(page3.data).toHaveLength(1);
			expect(page3.hasMore).toBe(false);
			expect(page3.data[0].likes).toBe(50);
		});

		test('should paginate via raw websocket messages', async () => {
			await insertPosts([100, 200, 300]);
			await new Promise((resolve) => setTimeout(resolve, 100));

			const waitForReply = (requestId: string) => {
				return new Promise<any>((resolve, reject) => {
					const timeout = setTimeout(() => {
						wsClient.client.ws.removeEventListener(
							'message',
							handler,
						);
						reject(new Error('Reply timeout'));
					}, 2000);

					const handler = (event: MessageEvent) => {
						const raw =
							typeof event.data === 'string'
								? event.data
								: event.data.toString();
						const payload = JSON.parse(raw);
						if (
							payload.type === 'REPLY' &&
							payload.id === requestId
						) {
							clearTimeout(timeout);
							wsClient.client.ws.removeEventListener(
								'message',
								handler,
							);
							resolve(payload);
						}
					};

					wsClient.client.ws.addEventListener('message', handler);
				});
			};

			// Page 1
			const reqId1 = generateId();
			const reply1Promise = waitForReply(reqId1);
			wsClient.client.ws.send(
				JSON.stringify({
					id: reqId1,
					type: 'QUERY',
					resource: 'posts',
					procedure: 'paginatedPosts',
					input: { pageSize: 2 },
				}),
			);
			const reply1 = await reply1Promise;
			expect(reply1.data.data).toHaveLength(2);
			expect(reply1.data.hasMore).toBe(true);

			// Page 2
			const reqId2 = generateId();
			const reply2Promise = waitForReply(reqId2);
			wsClient.client.ws.send(
				JSON.stringify({
					id: reqId2,
					type: 'QUERY',
					resource: 'posts',
					procedure: 'paginatedPosts',
					input: { cursor: reply1.data.nextCursor, pageSize: 2 },
				}),
			);
			const reply2 = await reply2Promise;
			expect(reply2.data.data).toHaveLength(1);
			expect(reply2.data.hasMore).toBe(false);
		});
	});

	describe('Edge Cases', () => {
		test('should return empty results for empty dataset', async () => {
			const result = await fetchClient.query.posts
				.orderBy('likes', 'asc')
				.limit(10)
				.get();

			expect(result).toHaveLength(0);
		});

		test('should return empty results for custom query on empty dataset', async () => {
			const result = await fetchClient.query.posts.paginatedPosts({
				pageSize: 10,
			});

			expect(result.data).toHaveLength(0);
			expect(result.hasMore).toBe(false);
			expect(result.nextCursor).toBeNull();
		});

		test('should handle single item dataset', async () => {
			await insertPosts([42]);

			const page1 = await fetchClient.query.posts
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page1).toHaveLength(1);
			expect(page1[0].likes).toBe(42);

			const page2 = await fetchClient.query.posts
				.where({ likes: { $gt: 42 } })
				.orderBy('likes', 'asc')
				.limit(2)
				.get();

			expect(page2).toHaveLength(0);
		});

		test('should handle page size larger than total items', async () => {
			await insertPosts([1, 2, 3]);

			const result = await fetchClient.query.posts
				.orderBy('likes', 'asc')
				.limit(100)
				.get();

			expect(result).toHaveLength(3);
			expect(result[0].likes).toBe(1);
			expect(result[1].likes).toBe(2);
			expect(result[2].likes).toBe(3);
		});

		test('should handle page size larger than total items with custom query', async () => {
			await insertPosts([1, 2, 3]);

			const result = await fetchClient.query.posts.paginatedPosts({
				pageSize: 100,
			});

			expect(result.data).toHaveLength(3);
			expect(result.hasMore).toBe(false);
		});

		test('should handle page size of 1', async () => {
			await insertPosts([10, 20, 30]);

			const pages: any[] = [];
			let cursor: number | undefined;
			let hasMore = true;

			while (hasMore) {
				const result = await fetchClient.query.posts.paginatedPosts({
					cursor,
					pageSize: 1,
				});
				pages.push(result);
				hasMore = result.hasMore;
				if (hasMore) cursor = result.nextCursor!;
			}

			expect(pages).toHaveLength(3);
			expect(pages[0].data[0].likes).toBe(10);
			expect(pages[1].data[0].likes).toBe(20);
			expect(pages[2].data[0].likes).toBe(30);
		});
	});
});
