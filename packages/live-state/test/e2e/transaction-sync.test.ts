/**
 * End-to-end test suite for transaction sync behavior (Issue #135)
 *
 * Tests that records inserted via trx.insert inside transactions
 * are properly synced to connected WebSocket clients.
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
	number,
	object,
	reference,
	string,
} from "../../src/schema";
import { routeFactory, router, server, expressAdapter } from "../../src/server";
import { SQLStorage } from "../../src/server/storage";
import { generateId } from "../../src/core/utils";
import { createClient } from "../../src/client";
import type { Server as HttpServer } from "http";
import { LogLevel } from "../../src/utils";

/**
 * Schema: users (1) <-> (N) posts
 */
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

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, "authorId"),
}));

const postRelations = createRelations(post, ({ one }) => ({
	author: one(user, "authorId"),
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
		users: publicRoute
			.collectionRoute(testSchema.users)
			.withProcedures(({ mutation }) => ({
				// Custom mutation that inserts a user inside a transaction
				createUserInTransaction: mutation(
					z.object({
						name: z.string(),
						email: z.string(),
					}),
				).handler(async ({ req, db }) => {
					const userId = generateId();
					await db.transaction(async ({ trx }) => {
						await trx.users.insert({
							id: userId,
							name: req.input.name,
							email: req.input.email,
						});
					});
					return { id: userId };
				}),

				// Custom mutation that inserts multiple records of the same
				// resource inside a transaction
				createMultipleUsersInTransaction: mutation(
					z.object({
						users: z.array(
							z.object({
								name: z.string(),
								email: z.string(),
							}),
						),
					}),
				).handler(async ({ req, db }) => {
					const ids: string[] = [];
					await db.transaction(async ({ trx }) => {
						for (const u of req.input.users) {
							const userId = generateId();
							await trx.users.insert({
								id: userId,
								name: u.name,
								email: u.email,
							});
							ids.push(userId);
						}
					});
					return { ids };
				}),
			})),

		posts: publicRoute
			.collectionRoute(testSchema.posts)
			.withProcedures(({ mutation }) => ({
				// Issue #135: Custom mutation that inserts a parent (user) and
				// child (post) inside a transaction. The parent has no FK columns
				// so its relation graph is only established when the child is
				// processed.
				createPostWithNewAuthor: mutation(
					z.object({
						authorName: z.string(),
						authorEmail: z.string(),
						postTitle: z.string(),
						postContent: z.string(),
					}),
				).handler(async ({ req, db }) => {
					const authorId = generateId();
					const postId = generateId();
					await db.transaction(async ({ trx }) => {
						await trx.users.insert({
							id: authorId,
							name: req.input.authorName,
							email: req.input.authorEmail,
						});
						await trx.posts.insert({
							id: postId,
							title: req.input.postTitle,
							content: req.input.postContent,
							authorId,
							likes: 0,
						});
					});
					return { authorId, postId };
				}),

				// Reverse insertion order: child first, then parent. The FK
				// is on the child so the relation is established on the first
				// insert, but the parent objectNode doesn't exist yet.
				createPostWithNewAuthorReversed: mutation(
					z.object({
						authorName: z.string(),
						authorEmail: z.string(),
						postTitle: z.string(),
						postContent: z.string(),
					}),
				).handler(async ({ req, db }) => {
					const authorId = generateId();
					const postId = generateId();
					await db.transaction(async ({ trx }) => {
						await trx.posts.insert({
							id: postId,
							title: req.input.postTitle,
							content: req.input.postContent,
							authorId,
							likes: 0,
						});
						await trx.users.insert({
							id: authorId,
							name: req.input.authorName,
							email: req.input.authorEmail,
						});
					});
					return { authorId, postId };
				}),

				// Inserts related records across resources without a transaction
				// (immediate notification per insert) for comparison
				createPostWithNewAuthorNoTransaction: mutation(
					z.object({
						authorName: z.string(),
						authorEmail: z.string(),
						postTitle: z.string(),
						postContent: z.string(),
					}),
				).handler(async ({ req, db }) => {
					const authorId = generateId();
					const postId = generateId();
					await db.users.insert({
						id: authorId,
						name: req.input.authorName,
						email: req.input.authorEmail,
					});
					await db.posts.insert({
						id: postId,
						title: req.input.postTitle,
						content: req.input.postContent,
						authorId,
						likes: 0,
					});
					return { authorId, postId };
				}),

				// Updates a record inside a transaction
				updatePostInTransaction: mutation(
					z.object({
						postId: z.string(),
						title: z.string(),
					}),
				).handler(async ({ req, db }) => {
					await db.transaction(async ({ trx }) => {
						await trx.posts.update(req.input.postId, {
							title: req.input.title,
						});
					});
					return { success: true };
				}),

				// Mixed insert + update in a transaction
				createPostAndUpdateAuthor: mutation(
					z.object({
						authorId: z.string(),
						authorName: z.string(),
						postTitle: z.string(),
						postContent: z.string(),
					}),
				).handler(async ({ req, db }) => {
					const postId = generateId();
					await db.transaction(async ({ trx }) => {
						await trx.posts.insert({
							id: postId,
							title: req.input.postTitle,
							content: req.input.postContent,
							authorId: req.input.authorId,
							likes: 0,
						});
						await trx.users.update(req.input.authorId, {
							name: req.input.authorName,
						});
					});
					return { postId };
				}),
			})),
	},
});

describe("Transaction Sync E2E Tests", () => {
	let storage: SQLStorage;
	let testServer: ReturnType<typeof server>;
	let sqliteDb: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;
	let httpServer: HttpServer | null = null;
	let serverPort: number;

	const waitForConnection = (client: ReturnType<typeof createClient>) => {
		return new Promise<void>((resolve) => {
			if (client.client.ws.connected()) {
				resolve();
				return;
			}

			const listener = () => {
				if (client.client.ws.connected()) {
					client.client.ws.removeEventListener(
						"connectionChange",
						listener,
					);
					resolve();
				}
			};

			client.client.ws.addEventListener("connectionChange", listener);
		});
	};

	beforeEach(async () => {
		sqliteDb = new Database(":memory:");
		sqliteDb.pragma("foreign_keys = ON");

		kyselyDb = new Kysely({
			dialect: new SqliteDialect({ database: sqliteDb }),
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
					typeof address === "object" && address?.port
						? address.port
						: 0;
				resolve(port);
			});
		});
	});

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
			httpServer = null;
		}

		if (kyselyDb) {
			try {
				await kyselyDb.schema
					.dropTable("posts_meta")
					.ifExists()
					.execute();
				await kyselyDb.schema.dropTable("posts").ifExists().execute();
				await kyselyDb.schema
					.dropTable("users_meta")
					.ifExists()
					.execute();
				await kyselyDb.schema.dropTable("users").ifExists().execute();
			} catch {
				// Ignore errors during cleanup
			}
		}

		if (sqliteDb) {
			sqliteDb.close();
		}
	});

	describe("Single resource: inserts via trx should sync", () => {
		let client: ReturnType<typeof createClient<typeof testRouter>>;

		beforeEach(async () => {
			client = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client.client.load(
				client.store.query.users.buildQueryRequest(),
			);
			await waitForConnection(client);
		});

		afterEach(() => {
			client?.client?.ws?.disconnect();
		});

		test("single insert inside transaction should sync to client", async () => {
			const receivedUpdates: any[] = [];
			const unsubscribe = client.store.query.users.subscribe((users) => {
				receivedUpdates.push([...users]);
			});
			await new Promise((resolve) => setTimeout(resolve, 100));

			const result =
				await client.store.mutate.users.createUserInTransaction({
					name: "Transaction User",
					email: "trx@example.com",
				});

			await new Promise((resolve) => setTimeout(resolve, 300));

			const users = await client.store.query.users.get();
			const created = users.find((u) => u.id === result.id);
			expect(created).toBeDefined();
			expect(created?.name).toBe("Transaction User");
			expect(created?.email).toBe("trx@example.com");

			unsubscribe();
		});

		test("multiple inserts of same resource inside transaction should all sync", async () => {
			const result =
				await client.store.mutate.users.createMultipleUsersInTransaction(
					{
						users: [
							{ name: "User A", email: "a@example.com" },
							{ name: "User B", email: "b@example.com" },
							{ name: "User C", email: "c@example.com" },
						],
					},
				);

			await new Promise((resolve) => setTimeout(resolve, 300));

			const users = await client.store.query.users.get();
			for (const id of result.ids) {
				expect(users.find((u) => u.id === id)).toBeDefined();
			}
			expect(
				users.filter((u) => result.ids.includes(u.id)).length,
			).toBe(3);
		});
	});

	describe("Multi-client: inserts via trx should sync to other clients", () => {
		let client1: ReturnType<typeof createClient<typeof testRouter>>;
		let client2: ReturnType<typeof createClient<typeof testRouter>>;

		beforeEach(async () => {
			client1 = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client1.client.load(
				client1.store.query.users.buildQueryRequest(),
			);
			await client1.client.load(
				client1.store.query.posts.buildQueryRequest(),
			);
			await waitForConnection(client1);

			client2 = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client2.client.load(
				client2.store.query.users.buildQueryRequest(),
			);
			await client2.client.load(
				client2.store.query.posts.buildQueryRequest(),
			);
			await waitForConnection(client2);
		});

		afterEach(() => {
			client1?.client?.ws?.disconnect();
			client2?.client?.ws?.disconnect();
		});

		test("single insert inside transaction should sync to other client", async () => {
			const receivedUpdates: any[] = [];
			const unsubscribe = client2.store.query.users.subscribe(
				(users) => {
					receivedUpdates.push([...users]);
				},
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			const result =
				await client1.store.mutate.users.createUserInTransaction({
					name: "Cross-Client User",
					email: "cross@example.com",
				});

			await new Promise((resolve) => setTimeout(resolve, 300));

			expect(receivedUpdates.length).toBeGreaterThan(0);
			const latestUsers =
				receivedUpdates[receivedUpdates.length - 1];
			const synced = latestUsers.find(
				(u: any) => u.id === result.id,
			);
			expect(synced).toBeDefined();
			expect(synced?.name).toBe("Cross-Client User");

			unsubscribe();
		});
	});

	describe("Cross-resource transaction sync (Issue #135)", () => {
		let client: ReturnType<typeof createClient<typeof testRouter>>;

		beforeEach(async () => {
			client = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client.client.load(
				client.store.query.users.buildQueryRequest(),
			);
			await client.client.load(
				client.store.query.posts.buildQueryRequest(),
			);
			await waitForConnection(client);
		});

		afterEach(() => {
			client?.client?.ws?.disconnect();
		});

		test("parent and child inserted in transaction should both sync (parent first)", async () => {
			const result =
				await client.store.mutate.posts.createPostWithNewAuthor({
					authorName: "New Author",
					authorEmail: "author@example.com",
					postTitle: "First Post",
					postContent: "Hello world",
				});

			await new Promise((resolve) => setTimeout(resolve, 300));

			// Both the user and the post should be visible to the client
			const users = await client.store.query.users.get();
			const author = users.find((u) => u.id === result.authorId);
			expect(author).toBeDefined();
			expect(author?.name).toBe("New Author");

			const posts = await client.store.query.posts.get();
			const post = posts.find((p) => p.id === result.postId);
			expect(post).toBeDefined();
			expect(post?.title).toBe("First Post");
			expect(post?.authorId).toBe(result.authorId);
		});

		test("parent and child inserted in transaction should both sync (child first)", async () => {
			const result =
				await client.store.mutate.posts.createPostWithNewAuthorReversed(
					{
						authorName: "Reversed Author",
						authorEmail: "reversed@example.com",
						postTitle: "Reversed Post",
						postContent: "Inserted child first",
					},
				);

			await new Promise((resolve) => setTimeout(resolve, 300));

			const users = await client.store.query.users.get();
			const author = users.find((u) => u.id === result.authorId);
			expect(author).toBeDefined();
			expect(author?.name).toBe("Reversed Author");

			const posts = await client.store.query.posts.get();
			const post = posts.find((p) => p.id === result.postId);
			expect(post).toBeDefined();
			expect(post?.title).toBe("Reversed Post");
		});

		test("non-transaction cross-resource inserts should sync (baseline)", async () => {
			const result =
				await client.store.mutate.posts.createPostWithNewAuthorNoTransaction(
					{
						authorName: "No Trx Author",
						authorEmail: "notrx@example.com",
						postTitle: "No Trx Post",
						postContent: "No transaction",
					},
				);

			await new Promise((resolve) => setTimeout(resolve, 300));

			const users = await client.store.query.users.get();
			const author = users.find((u) => u.id === result.authorId);
			expect(author).toBeDefined();
			expect(author?.name).toBe("No Trx Author");

			const posts = await client.store.query.posts.get();
			const post = posts.find((p) => p.id === result.postId);
			expect(post).toBeDefined();
			expect(post?.title).toBe("No Trx Post");
		});
	});

	describe("Updates inside transactions should sync", () => {
		let client: ReturnType<typeof createClient<typeof testRouter>>;

		beforeEach(async () => {
			client = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client.client.load(
				client.store.query.users.buildQueryRequest(),
			);
			await client.client.load(
				client.store.query.posts.buildQueryRequest(),
			);
			await waitForConnection(client);
		});

		afterEach(() => {
			client?.client?.ws?.disconnect();
		});

		test("update inside transaction should sync to client", async () => {
			// Seed data
			const authorId = generateId();
			const postId = generateId();
			await storage.insert(testSchema.users, {
				id: authorId,
				name: "Author",
				email: "author@example.com",
			});
			await storage.insert(testSchema.posts, {
				id: postId,
				title: "Original Title",
				content: "Content",
				authorId,
				likes: 0,
			});
			await new Promise((resolve) => setTimeout(resolve, 200));

			await client.store.mutate.posts.updatePostInTransaction({
				postId,
				title: "Updated Title",
			});

			await new Promise((resolve) => setTimeout(resolve, 300));

			const posts = await client.store.query.posts.get();
			const updated = posts.find((p) => p.id === postId);
			expect(updated).toBeDefined();
			expect(updated?.title).toBe("Updated Title");
		});

		test("insert + update across resources in one transaction should both sync", async () => {
			// Seed author
			const authorId = generateId();
			await storage.insert(testSchema.users, {
				id: authorId,
				name: "Original Name",
				email: "author@example.com",
			});
			await new Promise((resolve) => setTimeout(resolve, 200));

			const result =
				await client.store.mutate.posts.createPostAndUpdateAuthor({
					authorId,
					authorName: "Updated Name",
					postTitle: "New Post",
					postContent: "Content",
				});

			await new Promise((resolve) => setTimeout(resolve, 300));

			// Post should be created
			const posts = await client.store.query.posts.get();
			const newPost = posts.find((p) => p.id === result.postId);
			expect(newPost).toBeDefined();
			expect(newPost?.title).toBe("New Post");

			// Author name should be updated
			const users = await client.store.query.users.get();
			const author = users.find((u) => u.id === authorId);
			expect(author).toBeDefined();
			expect(author?.name).toBe("Updated Name");
		});
	});

	describe("Multi-client cross-resource transaction sync", () => {
		let client1: ReturnType<typeof createClient<typeof testRouter>>;
		let client2: ReturnType<typeof createClient<typeof testRouter>>;

		beforeEach(async () => {
			client1 = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client1.client.load(
				client1.store.query.users.buildQueryRequest(),
			);
			await client1.client.load(
				client1.store.query.posts.buildQueryRequest(),
			);
			await waitForConnection(client1);

			client2 = createClient({
				url: `ws://localhost:${serverPort}/ws`,
				schema: testSchema,
				storage: false,
				connection: { autoConnect: true, autoReconnect: false },
			});
			await client2.client.load(
				client2.store.query.users.buildQueryRequest(),
			);
			await client2.client.load(
				client2.store.query.posts.buildQueryRequest(),
			);
			await waitForConnection(client2);
		});

		afterEach(() => {
			client1?.client?.ws?.disconnect();
			client2?.client?.ws?.disconnect();
		});

		test("cross-resource transaction inserts should sync to other client", async () => {
			const receivedUsers: any[] = [];
			const receivedPosts: any[] = [];
			const unsub1 = client2.store.query.users.subscribe((users) => {
				receivedUsers.push([...users]);
			});
			const unsub2 = client2.store.query.posts.subscribe((posts) => {
				receivedPosts.push([...posts]);
			});
			await new Promise((resolve) => setTimeout(resolve, 100));

			const result =
				await client1.store.mutate.posts.createPostWithNewAuthor({
					authorName: "Shared Author",
					authorEmail: "shared@example.com",
					postTitle: "Shared Post",
					postContent: "Visible to all",
				});

			await new Promise((resolve) => setTimeout(resolve, 300));

			// Client2 should see the new user
			const users = await client2.store.query.users.get();
			const author = users.find((u: any) => u.id === result.authorId);
			expect(author).toBeDefined();
			expect(author?.name).toBe("Shared Author");

			// Client2 should see the new post
			const posts = await client2.store.query.posts.get();
			const post = posts.find((p: any) => p.id === result.postId);
			expect(post).toBeDefined();
			expect(post?.title).toBe("Shared Post");

			unsub1();
			unsub2();
		});

		test("mixed insert + update transaction should sync all changes to other client", async () => {
			// Seed author via storage (both clients will see it)
			const authorId = generateId();
			await storage.insert(testSchema.users, {
				id: authorId,
				name: "Original",
				email: "original@example.com",
			});
			await new Promise((resolve) => setTimeout(resolve, 200));

			const result =
				await client1.store.mutate.posts.createPostAndUpdateAuthor({
					authorId,
					authorName: "Renamed",
					postTitle: "New Post From Client1",
					postContent: "Content",
				});

			await new Promise((resolve) => setTimeout(resolve, 300));

			// Client2 should see the updated author name
			const users = await client2.store.query.users.get();
			const author = users.find((u: any) => u.id === authorId);
			expect(author).toBeDefined();
			expect(author?.name).toBe("Renamed");

			// Client2 should see the new post
			const posts = await client2.store.query.posts.get();
			const newPost = posts.find((p: any) => p.id === result.postId);
			expect(newPost).toBeDefined();
			expect(newPost?.title).toBe("New Post From Client1");
		});
	});
});
