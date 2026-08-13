/**
 * End-to-end coverage for relation-tree INSERT propagation.
 *
 * The concrete example models a thread with an author and a first message.
 * Both related rows are written before the thread row, so the foreign keys on
 * the root are valid when it is inserted. The root INSERT should deliver
 * the complete relation tree to a client subscribed to the Remote Query.
 */

import Database from 'better-sqlite3';
import express from 'express';
import expressWs from 'express-ws';
import { Kysely, SqliteDialect, type Selectable } from 'kysely';
import type { Server as HttpServer } from 'http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
	createRelations,
	createSchema,
	id,
	object,
	reference,
	string,
} from '../../src/schema';
import { createClient } from '../../src/client';
import type { CustomQueryRequest } from '../../src/core/schemas/core-protocol';
import { generateId } from '../../src/core/utils';
import { LogLevel } from '../../src/utils';
import { expressAdapter, routeFactory, router, server } from '../../src/server';
import { SQLStorage } from '../../src/server/storage';

const author = object('authors', {
	id: id(),
	name: string(),
});

const thread = object('threads', {
	id: id(),
	title: string(),
	authorId: reference('authors.id'),
	messageId: reference('messages.id'),
});

const message = object('messages', {
	id: id(),
	body: string(),
});

const reply = object('replies', {
	id: id(),
	body: string(),
	threadId: string(),
});

const authorRelations = createRelations(author, ({ many }) => ({
	threads: many(thread, 'authorId'),
}));

const threadRelations = createRelations(thread, ({ one, many }) => ({
	author: one(author, 'authorId'),
	message: one(message, 'messageId'),
	replies: many(reply, 'threadId'),
}));

const messageRelations = createRelations(message, ({ many }) => ({
	threads: many(thread, 'messageId'),
}));

const replyRelations = createRelations(reply, ({ one }) => ({
	thread: one(thread, 'threadId'),
}));

const threadInclude = { author: true, message: true } as const;
const filteredRepliesThreadInclude = {
	author: true,
	message: true,
	replies: {
		where: { body: { $not: 'Excluded reply' } },
		limit: 1,
		orderBy: [{ key: 'body', direction: 'asc' }],
	},
} as const;

const relationTreeInput = z.object({
	authorId: z.string(),
	threadId: z.string(),
	messageId: z.string(),
});

const testSchema = createSchema({
	authors: author,
	threads: thread,
	messages: message,
	replies: reply,
	authorRelations,
	threadRelations,
	messageRelations,
	replyRelations,
});

const publicRoute = routeFactory();

const testRouter = router({
	schema: testSchema,
	routes: {
		threads: publicRoute.withProcedures(({ mutation, query }) => ({
			listRelationTree: query().handler(({ db }) =>
				db.threads.include(threadInclude),
			),
			listRelationTreeWithFilteredReplies: query().handler(({ db }) =>
				db.threads.include(filteredRepliesThreadInclude),
			),
			listRoots: query().handler(({ db }) => db.threads),
			createRelationTree: mutation(relationTreeInput).handler(
				async ({ req, db }) => {
					await db.transaction(async ({ trx }) => {
						await trx.authors.insert({
							id: req.input.authorId,
							name: 'New author',
						});
						await trx.messages.insert({
							id: req.input.messageId,
							body: 'First message',
						});
						await trx.threads.insert({
							id: req.input.threadId,
							title: 'New thread',
							authorId: req.input.authorId,
							messageId: req.input.messageId,
						});
					});

					return {
						authorId: req.input.authorId,
						threadId: req.input.threadId,
						messageId: req.input.messageId,
					};
				},
			),
			createRelationTreeWithoutTransaction: mutation(relationTreeInput).handler(
				async ({ req, db }) => {
					await db.authors.insert({
						id: req.input.authorId,
						name: 'New author',
					});
					await db.messages.insert({
						id: req.input.messageId,
						body: 'First message',
					});
					await db.threads.insert({
						id: req.input.threadId,
						title: 'New thread',
						authorId: req.input.authorId,
						messageId: req.input.messageId,
					});

					return {
						authorId: req.input.authorId,
						threadId: req.input.threadId,
						messageId: req.input.messageId,
					};
				},
			),
			createThreadWithExistingRelations: mutation(relationTreeInput).handler(
				async ({ req, db }) => {
					await db.transaction(async ({ trx }) => {
						await trx.threads.insert({
							id: req.input.threadId,
							title: 'New thread',
							authorId: req.input.authorId,
							messageId: req.input.messageId,
						});
					});

					return {
						authorId: req.input.authorId,
						threadId: req.input.threadId,
						messageId: req.input.messageId,
					};
				},
			),
		})),
		authors: publicRoute.withProcedures(({ query }) => ({
			list: query().handler(({ db }) => db.authors),
		})),
		messages: publicRoute.withProcedures(({ query }) => ({
			list: query().handler(({ db }) => db.messages),
		})),
	},
});

describe('Relation tree sync E2E', () => {
	type TestClient = ReturnType<typeof createClient<typeof testRouter>>;

	let storage: SQLStorage;
	let sqliteDb: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<unknown> }>;
	let testServer: ReturnType<typeof server>;
	let httpServer: HttpServer | null = null;
	let serverPort: number;

	const waitForConnection = (client: ReturnType<typeof createClient>) =>
		new Promise<void>((resolve) => {
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

	const waitUntil = async (
		predicate: () => boolean,
		description = 'condition',
	) => {
		const startedAt = Date.now();
		while (Date.now() - startedAt < 2000) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		throw new Error(`Timed out waiting for ${description}`);
	};

	const loadRemoteQueries = async (
		client: TestClient,
		queries: CustomQueryRequest[],
	) => {
		let replyCount = 0;
		const removeReplyListener = client.client.addEventListener((event) => {
			if (event.type === 'DATA_LOAD_REPLY') replyCount += 1;
		});
		const unsubscribeQueries = queries.map((query) =>
			client.client.load(query),
		);

		try {
			await waitUntil(
				() => replyCount >= queries.length,
				`${queries.length} Remote Query bootstrap replies`,
			);
		} catch (error) {
			unsubscribeQueries.forEach((unsubscribe) => unsubscribe());
			removeReplyListener();
			throw error;
		}

		removeReplyListener();
		return () => {
			unsubscribeQueries.forEach((unsubscribe) => unsubscribe());
		};
	};

	const getThread = (client: TestClient, threadId: string) =>
		client.store.query.threads
			.include(threadInclude)
			.get()
			.find((row) => row.id === threadId);

	const createTestClient = () =>
		createClient({
			url: `ws://localhost:${serverPort}/ws`,
			schema: testSchema,
			storage: false,
			connection: { autoConnect: true, autoReconnect: false },
		});

	const seedRelatedRows = async (authorId: string, messageId: string) => {
		await storage.insert(testSchema.authors, {
			id: authorId,
			name: 'Existing author',
		});
		await storage.insert(testSchema.messages, {
			id: messageId,
			body: 'Existing message',
		});
	};

	const seedReplies = async (
		threadId: string,
		replies: { id: string; body: string }[],
	) => {
		// Bypass storage mutations so the child rows exist without creating a
		// placeholder parent in the live relation graph before the root INSERT.
		const insertReply = sqliteDb.prepare(
			'INSERT INTO replies (id, body, threadId) VALUES (?, ?, ?)',
		);
		const insertReplyMeta = sqliteDb.prepare(
			'INSERT INTO replies_meta (id) VALUES (?)',
		);

		for (const row of replies) {
			insertReply.run(row.id, row.body, threadId);
			insertReplyMeta.run(row.id);
		}
	};

	const expectHydratedThread = (
		client: TestClient,
		authorId: string,
		threadId: string,
		messageId: string,
	) => {
		const hydratedThread = getThread(client, threadId);
		expect(hydratedThread?.author).toEqual(
			expect.objectContaining({ id: authorId }),
		);
		expect(hydratedThread?.message).toEqual(
			expect.objectContaining({ id: messageId }),
		);
	};

	beforeEach(async () => {
		sqliteDb = new Database(':memory:');
		sqliteDb.pragma('foreign_keys = ON');
		kyselyDb = new Kysely({
			dialect: new SqliteDialect({ database: sqliteDb }),
		});

		storage = new SQLStorage(kyselyDb, testSchema);
		await storage.init(testSchema);

		testServer = server({
			router: testRouter,
			storage,
			schema: testSchema,
			logLevel: LogLevel.INFO,
		});

		const { app } = expressWs(express());
		app.use(express.json());
		app.use(express.urlencoded({ extended: true }));
		expressAdapter(app, testServer);

		serverPort = await new Promise<number>((resolve) => {
			httpServer = app.listen(0, () => {
				const address = httpServer?.address();
				resolve(
					typeof address === 'object' && address?.port ? address.port : 0,
				);
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

		await kyselyDb.destroy();
		sqliteDb.close();
	});

	test('root INSERT syncs its complete relation tree for newly created rows', async () => {
		const authorId = generateId();
		const threadId = generateId();
		const messageId = generateId();

		const client = createTestClient();

		const receivedResources: string[] = [];
		const removeEventListener = client.client.addEventListener((event) => {
			if (event.type === 'MUTATION_RECEIVED')
				receivedResources.push(event.resource);
		});
		let unsubscribeQueries: (() => void) | undefined;

		try {
			await waitForConnection(client);
			const remoteQuery = client.store.query.threads.listRelationTree();
			unsubscribeQueries = await loadRemoteQueries(client, [
				remoteQuery.buildQueryRequest(),
			]);

			await client.store.mutate.threads.createRelationTree({
				authorId,
				threadId,
				messageId,
			});

			await waitUntil(
				() =>
					client.store.query.threads.get().some((row) => row.id === threadId),
				'root INSERT',
			);
			await waitUntil(() => {
				const liveThread = getThread(client, threadId);
				return (
					liveThread?.author?.id === authorId &&
					liveThread.message?.id === messageId
				);
			}, 'relation tree after root INSERT');

			// The root INSERT now carries the complete relation tree as separate
			// resource deltas, without requiring a refresh.
			expect(receivedResources).toEqual(
				expect.arrayContaining(['threads', 'authors', 'messages']),
			);
			expectHydratedThread(client, authorId, threadId, messageId);

			const unsubscribeRefresh = client.client.load(
				remoteQuery.buildQueryRequest(),
			);
			try {
				await waitUntil(() => {
					const hydratedThread = getThread(client, threadId);
					return (
						hydratedThread?.author?.id === authorId &&
						hydratedThread.message?.id === messageId
					);
				}, 'relation tree hydration after refresh');
			} finally {
				unsubscribeRefresh();
			}

			const hydratedThread = getThread(client, threadId);
			expect(hydratedThread?.author).toEqual(
				expect.objectContaining({ id: authorId, name: 'New author' }),
			);
			expect(hydratedThread?.message).toEqual(
				expect.objectContaining({ id: messageId, body: 'First message' }),
			);
		} finally {
			unsubscribeQueries?.();
			removeEventListener();
			client.client.ws.disconnect();
		}
	});

	test('root INSERT syncs existing related rows that are not yet in the client store', async () => {
		const authorId = generateId();
		const threadId = generateId();
		const messageId = generateId();
		await seedRelatedRows(authorId, messageId);

		const client = createTestClient();
		const receivedResources: string[] = [];
		const removeEventListener = client.client.addEventListener((event) => {
			if (event.type === 'MUTATION_RECEIVED')
				receivedResources.push(event.resource);
		});

		try {
			await waitForConnection(client);
			const remoteQuery = client.store.query.threads.listRelationTree();
			const unsubscribeQueries = await loadRemoteQueries(client, [
				remoteQuery.buildQueryRequest(),
			]);

			try {
				await client.store.mutate.threads.createThreadWithExistingRelations({
					authorId,
					threadId,
					messageId,
				});

				await waitUntil(
					() =>
						client.store.query.threads.get().some((row) => row.id === threadId),
					'root INSERT with existing relations',
				);

				expectHydratedThread(client, authorId, threadId, messageId);
				expect(receivedResources).toEqual(
					expect.arrayContaining(['authors', 'threads', 'messages']),
				);
			} finally {
				unsubscribeQueries();
			}
		} finally {
			removeEventListener();
			client.client.ws.disconnect();
		}
	});

	test('root INSERT syncs its complete relation tree when writes are not transactional', async () => {
		const authorId = generateId();
		const threadId = generateId();
		const messageId = generateId();

		const client = createTestClient();
		const receivedResources: string[] = [];
		const removeEventListener = client.client.addEventListener((event) => {
			if (event.type === 'MUTATION_RECEIVED')
				receivedResources.push(event.resource);
		});

		try {
			await waitForConnection(client);
			const remoteQuery = client.store.query.threads.listRelationTree();
			const unsubscribeQueries = await loadRemoteQueries(client, [
				remoteQuery.buildQueryRequest(),
			]);

			try {
				await client.store.mutate.threads.createRelationTreeWithoutTransaction({
					authorId,
					threadId,
					messageId,
				});

				await waitUntil(
					() =>
						client.store.query.threads.get().some((row) => row.id === threadId),
					'root INSERT without a transaction',
				);

				expectHydratedThread(client, authorId, threadId, messageId);
				expect(receivedResources).toEqual(
					expect.arrayContaining(['authors', 'threads', 'messages']),
				);
			} finally {
				unsubscribeQueries();
			}
		} finally {
			removeEventListener();
			client.client.ws.disconnect();
		}
	});

	test('root-only queries sync only the root row', async () => {
		const authorId = generateId();
		const threadId = generateId();
		const messageId = generateId();

		const client = createTestClient();
		const receivedResources: string[] = [];
		const removeEventListener = client.client.addEventListener((event) => {
			if (event.type === 'MUTATION_RECEIVED')
				receivedResources.push(event.resource);
		});

		try {
			await waitForConnection(client);
			const rootQuery = client.store.query.threads.listRoots();
			const unsubscribeQueries = await loadRemoteQueries(client, [
				rootQuery.buildQueryRequest(),
			]);

			try {
				await client.store.mutate.threads.createRelationTree({
					authorId,
					threadId,
					messageId,
				});

				await waitUntil(
					() =>
						client.store.query.threads.get().some((row) => row.id === threadId),
					'root-only INSERT',
				);

				expect(receivedResources).toEqual(['threads']);
				expect(
					client.store.query.threads.get().find((row) => row.id === threadId),
				).toEqual(
					expect.objectContaining({ id: threadId, title: 'New thread' }),
				);
			} finally {
				unsubscribeQueries();
			}
		} finally {
			removeEventListener();
			client.client.ws.disconnect();
		}
	});

	test('a relation tree uses related rows already hydrated by another query', async () => {
		const authorId = generateId();
		const threadId = generateId();
		const messageId = generateId();
		await seedRelatedRows(authorId, messageId);

		const client = createTestClient();
		const receivedResources: string[] = [];
		const removeEventListener = client.client.addEventListener((event) => {
			if (event.type === 'MUTATION_RECEIVED')
				receivedResources.push(event.resource);
		});

		try {
			await waitForConnection(client);
			const authorQuery = client.store.query.authors.list();
			const messageQuery = client.store.query.messages.list();
			const relationTreeQuery = client.store.query.threads.listRelationTree();
			const unsubscribeQueries = await loadRemoteQueries(client, [
				authorQuery.buildQueryRequest(),
				messageQuery.buildQueryRequest(),
				relationTreeQuery.buildQueryRequest(),
			]);

			try {
				await waitUntil(
					() =>
						client.store.query.authors
							.get()
							.some((row) => row.id === authorId) &&
						client.store.query.messages
							.get()
							.some((row) => row.id === messageId),
					'related rows to be hydrated',
				);

				await client.store.mutate.threads.createThreadWithExistingRelations({
					authorId,
					threadId,
					messageId,
				});

				await waitUntil(
					() =>
						client.store.query.threads.get().some((row) => row.id === threadId),
					'root INSERT with hydrated relations',
				);

				expectHydratedThread(client, authorId, threadId, messageId);
				expect(receivedResources).toContain('threads');
			} finally {
				unsubscribeQueries();
			}
		} finally {
			removeEventListener();
			client.client.ws.disconnect();
		}
	});

	test('a relation tree preserves filters and limits on many relations', async () => {
		const authorId = generateId();
		const threadId = generateId();
		const messageId = generateId();
		const includedReplyId = generateId();
		const limitedOutReplyId = generateId();
		const excludedReplyId = generateId();
		await seedRelatedRows(authorId, messageId);
		await seedReplies(threadId, [
			{ id: includedReplyId, body: 'Included reply' },
			{ id: limitedOutReplyId, body: 'Second included reply' },
			{ id: excludedReplyId, body: 'Excluded reply' },
		]);

		const client = createTestClient();
		let unsubscribeQueries: (() => void) | undefined;

		try {
			await waitForConnection(client);
			const remoteQuery =
				client.store.query.threads.listRelationTreeWithFilteredReplies();
			unsubscribeQueries = await loadRemoteQueries(client, [
				remoteQuery.buildQueryRequest(),
			]);

			await client.store.mutate.threads.createThreadWithExistingRelations({
				authorId,
				threadId,
				messageId,
			});

			await waitUntil(() => {
				const hydratedThread = client.store.query.threads
					.include(filteredRepliesThreadInclude)
					.get()
					.find((row) => row.id === threadId);
				return hydratedThread?.replies?.some(
					(row) => row.id === includedReplyId,
				);
			}, 'filtered relation tree after root INSERT');

			const hydratedThread = client.store.query.threads
				.include(filteredRepliesThreadInclude)
				.get()
				.find((row) => row.id === threadId);
			expect(hydratedThread?.replies).toEqual([
				expect.objectContaining({ id: includedReplyId }),
			]);
			expect(
				client.store.query.replies
					.get()
					.some(
						(row) => row.id === limitedOutReplyId || row.id === excludedReplyId,
					),
			).toBe(false);
		} finally {
			unsubscribeQueries?.();
			client.client.ws.disconnect();
		}
	});
});
