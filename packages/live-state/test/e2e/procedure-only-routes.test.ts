/**
 * End-to-end test suite for procedure-only routes (not tied to a collection).
 * Tests that ProcedureRoute works correctly via both WebSocket and Fetch clients.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Selectable } from "kysely";
import express from "express";
import expressWs from "express-ws";
import { z } from "zod";
import {
	createSchema,
	createRelations,
	id,
	inferValue,
	number,
	object,
	reference,
	string,
} from "../../src/schema";
import { routeFactory, router, server, expressAdapter } from "../../src/server";
import { SQLStorage } from "../../src/server/storage";
import { generateId } from "../../src/core/utils";
import { createClient } from "../../src/client";
import { createClient as createFetchClient } from "../../src/client/fetch";
import type { Server as HttpServer } from "http";
import { LogLevel } from "../../src/utils";

const user = object("users", {
	id: id(),
	name: string(),
	email: string(),
});

const post = object("posts", {
	id: id(),
	title: string(),
	content: string(),
	authorId: reference("users.id"),
	likes: number(),
});

// A resource that is in the schema but has NO collectionRoute declared.
// It is only ever read via a procedure-only route returning a tracked query.
const comment = object("comments", {
	id: id(),
	text: string(),
	topic: string(),
});

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, "authorId"),
}));

const postRelations = createRelations(post, ({ one }) => ({
	author: one(user, "authorId"),
}));

const testSchema = createSchema({
	users: user,
	posts: post,
	comments: comment,
	userRelations,
	postRelations,
});

const publicRoute = routeFactory();

const testRouter = router({
	schema: testSchema,
	routes: {
		users: publicRoute
			.collectionRoute(testSchema.users)
			.withProcedures(({ mutation }) => ({
				insert: mutation(
					z.object({
						id: z.string(),
						name: z.string(),
						email: z.string(),
					})
				).handler(async ({ req, db }) => db.users.insert(req.input)),
			})),
		posts: publicRoute.collectionRoute(testSchema.posts),

		// Procedure-only route
		analytics: publicRoute.withProcedures(({ mutation, query }) => ({
			getUserCount: query().handler(async ({ db }) => {
				const users = await db.users.get();
				return { count: users.length };
			}),

			getPostsByAuthor: query(z.object({ authorName: z.string() })).handler(
				async ({ req, db }) => {
					const users = await db.users
						.where({ name: req.input.authorName })
						.get();
					if (users.length === 0) return [];
					const userId = users[0].id;
					return db.posts.where({ authorId: userId }).get();
				}
			),

			// Returns an *unresolved* query builder for `comments`, a resource
			// with no collectionRoute. The query engine must resolve and subscribe
			// it directly against the batcher/storage keyed by `resource`.
			watchComments: query(z.object({ topic: z.string() })).handler(
				({ req, db }) => db.comments.where({ topic: req.input.topic })
			),

			seedData: mutation(
				z.object({
					userName: z.string(),
					postTitle: z.string(),
				})
			).handler(async ({ req, db }) => {
				const userId = generateId();
				await db.users.insert({
					id: userId,
					name: req.input.userName,
					email: `${req.input.userName.toLowerCase().replace(/\s+/g, ".")}@test.com`,
				});
				const postId = generateId();
				await db.posts.insert({
					id: postId,
					title: req.input.postTitle,
					content: "Seeded content",
					authorId: userId,
					likes: 0,
				});
				return { userId, postId };
			}),

			resetLikes: mutation().handler(async ({ db }) => {
				const posts = await db.posts.get();
				let count = 0;
				for (const p of posts) {
					await db.posts.update(p.id, { likes: 0 });
					count++;
				}
				return { resetCount: count };
			}),
		})),
	},
});

describe("Procedure-Only Routes E2E", () => {
	let storage: SQLStorage;
	let testServer: ReturnType<typeof server>;
	let db: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;
	let httpServer: HttpServer | null = null;
	let serverPort: number;
	let wsClient: ReturnType<typeof createClient<typeof testRouter>>;
	let fetchClient: ReturnType<typeof createFetchClient<typeof testRouter>>;

	const waitForConnection = (client: ReturnType<typeof createClient>) => {
		return new Promise<void>((resolve) => {
			if (client.client.ws.connected()) {
				resolve();
				return;
			}

			const listener = () => {
				if (client.client.ws.connected()) {
					client.client.ws.removeEventListener("connectionChange", listener);
					resolve();
				}
			};

			client.client.ws.addEventListener("connectionChange", listener);
		});
	};

	beforeEach(async () => {
		db = new Database(":memory:");
		db.pragma("foreign_keys = ON");

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
					typeof address === "object" && address?.port ? address.port : 0;
				resolve(port);
			});
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
		db?.close();
	});

	describe("WebSocket client", () => {
		test("should call custom query without input on procedure route", async () => {
			await storage.insert(testSchema.users, {
				id: generateId(),
				name: "Alice",
				email: "alice@test.com",
			});
			await storage.insert(testSchema.users, {
				id: generateId(),
				name: "Bob",
				email: "bob@test.com",
			});

			const result = await wsClient.store.query.analytics.getUserCount();

			expect(result).toEqual({ count: 2 });
		});

		test("should call custom query with input on procedure route", async () => {
			const userId = generateId();
			await storage.insert(testSchema.users, {
				id: userId,
				name: "Alice",
				email: "alice@test.com",
			});
			await storage.insert(testSchema.posts, {
				id: generateId(),
				title: "Alice's Post",
				content: "Hello world",
				authorId: userId,
				likes: 5,
			});

			const result = await wsClient.store.query.analytics.getPostsByAuthor({
				authorName: "Alice",
			});

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(1);
			expect(result[0].title).toBe("Alice's Post");
		});

		test("should call custom mutation with input on procedure route", async () => {
			const result = await wsClient.store.mutate.analytics.seedData({
				userName: "Charlie",
				postTitle: "First Post",
			});

			expect(result.userId).toBeDefined();
			expect(result.postId).toBeDefined();

			const count = await wsClient.store.query.analytics.getUserCount();
			expect(count).toEqual({ count: 1 });
		});

		test("should call custom mutation without input on procedure route", async () => {
			const userId = generateId();
			await storage.insert(testSchema.users, {
				id: userId,
				name: "Alice",
				email: "alice@test.com",
			});
			await storage.insert(testSchema.posts, {
				id: generateId(),
				title: "Post 1",
				content: "Content",
				authorId: userId,
				likes: 10,
			});
			await storage.insert(testSchema.posts, {
				id: generateId(),
				title: "Post 2",
				content: "Content",
				authorId: userId,
				likes: 20,
			});

			const result = await wsClient.store.mutate.analytics.resetLikes();

			expect(result).toEqual({ resetCount: 2 });
		});

		test("should validate mutation input on procedure route", async () => {
			await expect(
				(wsClient.store.mutate.analytics.seedData as any)({ userName: 123 }),
			).rejects.toThrow();
		});
	});

	describe("Fetch client", () => {
		test("should call custom query without input on procedure route", async () => {
			await storage.insert(testSchema.users, {
				id: generateId(),
				name: "Alice",
				email: "alice@test.com",
			});

			const result = await fetchClient.query.analytics.getUserCount();

			expect(result).toEqual({ count: 1 });
		});

		test("should call custom query with input on procedure route", async () => {
			const userId = generateId();
			await storage.insert(testSchema.users, {
				id: userId,
				name: "Bob",
				email: "bob@test.com",
			});
			await storage.insert(testSchema.posts, {
				id: generateId(),
				title: "Bob's Post",
				content: "Content",
				authorId: userId,
				likes: 3,
			});

			const result = await fetchClient.query.analytics.getPostsByAuthor({
				authorName: "Bob",
			});

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(1);
		});

		test("should call custom mutation with input on procedure route", async () => {
			const result = await fetchClient.mutate.analytics.seedData({
				userName: "Diana",
				postTitle: "Diana's Post",
			});

			expect(result.userId).toBeDefined();
			expect(result.postId).toBeDefined();
		});

		test("should call custom mutation without input on procedure route", async () => {
			const result = await fetchClient.mutate.analytics.resetLikes();

			expect(result).toEqual({ resetCount: 0 });
		});
	});

	describe("Tracked query returned from a procedure-only route", () => {
		test("resolves and subscribes a resource with no collectionRoute", async () => {
			const matchingId = generateId();
			await storage.insert(testSchema.comments, {
				id: matchingId,
				text: "initial",
				topic: "sync",
			});
			await storage.insert(testSchema.comments, {
				id: generateId(),
				text: "other topic",
				topic: "unrelated",
			});

			const deltas: any[] = [];

			const result = await testServer.handleCustomQuery({
				req: {
					headers: {},
					cookies: {},
					queryParams: {},
					type: "CUSTOM_QUERY",
					resource: "analytics",
					procedure: "watchComments",
					input: { topic: "sync" },
					context: {},
				},
				subscription: (m) => deltas.push(m),
			});

			// Initial resolution against storage, filtered by the handler's where.
			expect(result.data).toHaveLength(1);
			expect(inferValue(result.data[0]).text).toBe("initial");

			// Realtime: a new matching comment produces a Sync Delta to the subscriber.
			const newId = generateId();
			await storage.insert(testSchema.comments, {
				id: newId,
				text: "live",
				topic: "sync",
			});

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(deltas.some((d) => d.resourceId === newId)).toBe(true);

			// A non-matching comment must NOT notify the subscriber.
			const nonMatchingId = generateId();
			await storage.insert(testSchema.comments, {
				id: nonMatchingId,
				text: "nope",
				topic: "unrelated",
			});

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(deltas.some((d) => d.resourceId === nonMatchingId)).toBe(false);

			result.unsubscribe?.();
		});
	});

	describe("Collection routes still work alongside procedure routes", () => {
		test("should still support collection queries via WS", async () => {
			await storage.insert(testSchema.users, {
				id: generateId(),
				name: "Alice",
				email: "alice@test.com",
			});

			await wsClient.client.load(
				wsClient.store.query.users.buildQueryRequest(),
			);

			// Wait for data to load
			await new Promise<void>((resolve) => {
				const check = () => {
					const result = wsClient.store.query.users.get();
					if (result.length > 0) {
						resolve();
					} else {
						setTimeout(check, 50);
					}
				};
				check();
			});

			const users = wsClient.store.query.users.get();
			expect(users.length).toBe(1);
			expect(users[0].name).toBe("Alice");
		});

		test("should still support collection mutations via fetch", async () => {
			await fetchClient.mutate.users.insert({
				id: generateId(),
				name: "Bob",
				email: "bob@test.com",
			});

			const count = await fetchClient.query.analytics.getUserCount();
			expect(count).toEqual({ count: 1 });
		});
	});
});
