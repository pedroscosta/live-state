/**
 * Projection identity (ADR-0006 §1): a projection is identified by its whole
 * resolved query tree and owns its step nodes. Queries that differ only in
 * `limit`/`sort`, or roots that share an include path, must not share nodes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, type Selectable } from 'kysely';
import {
	createRelations,
	createSchema,
	id,
	number,
	object,
	reference,
	string,
} from '../../src/schema';
import { routeFactory, router, server } from '../../src/server';
import { SQLStorage } from '../../src/server/storage';
import { LogLevel } from '../../src/utils';

const user = object('users', {
	id: id(),
	name: string(),
});

const post = object('posts', {
	id: id(),
	title: string(),
	status: string(),
	rank: number(),
	authorId: reference('users.id'),
});

const comment = object('comments', {
	id: id(),
	body: string(),
	postId: reference('posts.id'),
	authorId: reference('users.id'),
});

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, 'authorId'),
	comments: many(comment, 'authorId'),
}));

const postRelations = createRelations(post, ({ one, many }) => ({
	author: one(user, 'authorId'),
	comments: many(comment, 'postId'),
}));

const commentRelations = createRelations(comment, ({ one }) => ({
	post: one(post, 'postId'),
	author: one(user, 'authorId'),
}));

const testSchema = createSchema({
	users: user,
	posts: post,
	comments: comment,
	userRelations,
	postRelations,
	commentRelations,
});

const publicRoute = routeFactory();

const testRouter = router({
	schema: testSchema,
	routes: {
		users: publicRoute.withProcedures(() => ({})),
		posts: publicRoute.withProcedures(() => ({})),
		comments: publicRoute.withProcedures(() => ({})),
	},
});

// biome-ignore lint/suspicious/noExplicitAny: SyncDelta payloads are loosely typed in tests
type Delta = any;

describe('Projection identity', () => {
	let storage: SQLStorage;
	let testServer: ReturnType<typeof server>;
	let db: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;

	const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

	// biome-ignore lint/suspicious/noExplicitAny: raw query requests in tests
	const subscribe = async (query: any) => {
		const deltas: Delta[] = [];
		const ctx = { headers: {}, cookies: {}, queryParams: {}, context: {} };
		const unsubscribe = testServer.queryEngine.subscribe(
			query,
			(d) => deltas.push(d),
			ctx,
		);
		const data = await testServer.queryEngine.get(query, { context: ctx });
		return { deltas, data, unsubscribe };
	};

	const idsOf = (deltas: Delta[], op: string) =>
		deltas.filter((d) => d.op === op).map((d) => d.resourceId);

	beforeEach(async () => {
		db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		kyselyDb = new Kysely({ dialect: new SqliteDialect({ database: db }) });

		storage = new SQLStorage(kyselyDb, testSchema);
		await storage.init(testSchema);

		testServer = server({
			router: testRouter,
			storage,
			schema: testSchema,
			logLevel: LogLevel.ERROR,
		});

		await storage.insert(testSchema.users, { id: 'u1', name: 'Ann' });
		await storage.insert(testSchema.users, { id: 'u2', name: 'Bob' });
		await storage.insert(testSchema.users, { id: 'u3', name: 'Cid' });

		for (const [pid, rank, authorId, status] of [
			['p10', 10, 'u1', 'a'],
			['p20', 20, 'u1', 'a'],
			['p30', 30, 'u1', 'a'],
			['p40', 40, 'u2', 'b'],
		] as const) {
			await storage.insert(testSchema.posts, {
				id: pid,
				title: pid,
				status,
				rank,
				authorId,
			});
		}
	});

	afterEach(async () => {
		await kyselyDb.destroy();
	});

	test('queries differing only in limit keep separate windows', async () => {
		const sort = [{ key: 'rank', direction: 'desc' }];
		const top2 = await subscribe({ resource: 'posts', sort, limit: 2 });
		const top3 = await subscribe({ resource: 'posts', sort, limit: 3 });

		// rank 25 lands between the 2nd (30) and 3rd (20) row: outside top-2,
		// inside top-3 where it evicts p20.
		await storage.insert(testSchema.posts, {
			id: 'p25',
			title: 'p25',
			status: 'a',
			rank: 25,
			authorId: 'u1',
		});
		await settle();

		expect(top2.deltas).toEqual([]);
		expect(idsOf(top3.deltas, 'INSERT')).toEqual(['p25']);
		expect(idsOf(top3.deltas, 'DELETE')).toEqual(['p20']);

		top2.unsubscribe();
		top3.unsubscribe();
	});

	test('queries differing only in sort keep separate windows', async () => {
		const desc = await subscribe({
			resource: 'posts',
			sort: [{ key: 'rank', direction: 'desc' }],
			limit: 2,
		});
		const asc = await subscribe({
			resource: 'posts',
			sort: [{ key: 'rank', direction: 'asc' }],
			limit: 2,
		});

		await storage.insert(testSchema.posts, {
			id: 'p5',
			title: 'p5',
			status: 'a',
			rank: 5,
			authorId: 'u1',
		});
		await settle();

		expect(desc.deltas).toEqual([]);
		expect(idsOf(asc.deltas, 'INSERT')).toEqual(['p5']);
		expect(idsOf(asc.deltas, 'DELETE')).toEqual(['p20']);

		desc.unsubscribe();
		asc.unsubscribe();
	});

	test('roots sharing an include path get their own include nodes', async () => {
		const qa = await subscribe({
			resource: 'posts',
			where: { status: 'a' },
			include: { author: true },
		});
		const qb = await subscribe({
			resource: 'posts',
			where: { status: 'b' },
			include: { author: true },
		});

		// u2 is only reachable from qb's posts; u1 only from qa's.
		await storage.update(testSchema.users, 'u2', { name: 'Bobby' });
		await storage.update(testSchema.users, 'u1', { name: 'Annie' });
		await settle();

		expect(idsOf(qa.deltas, 'UPDATE')).toEqual(['u1']);
		expect(idsOf(qb.deltas, 'UPDATE')).toEqual(['u2']);

		qa.unsubscribe();
		qb.unsubscribe();
	});

	test('a nested include follows its own projection parent', async () => {
		const qa = await subscribe({
			resource: 'posts',
			where: { status: 'a' },
			include: { comments: { include: { author: true } } },
		});
		const qb = await subscribe({
			resource: 'posts',
			where: { status: 'b' },
			include: { comments: { include: { author: true } } },
		});

		await storage.insert(testSchema.comments, {
			id: 'c1',
			body: 'on b',
			postId: 'p40',
			authorId: 'u3',
		});
		await settle();

		expect(idsOf(qa.deltas, 'INSERT')).toEqual([]);
		expect(idsOf(qb.deltas, 'INSERT')).toContain('c1');

		await storage.update(testSchema.users, 'u3', { name: 'Cyd' });
		await settle();

		expect(idsOf(qa.deltas, 'UPDATE')).toEqual([]);
		expect(idsOf(qb.deltas, 'UPDATE')).toContain('u3');

		// And the other way round: a comment on qa's post reaches only qa.
		await storage.insert(testSchema.comments, {
			id: 'c2',
			body: 'on a',
			postId: 'p10',
			authorId: 'u2',
		});
		await settle();

		expect(idsOf(qa.deltas, 'INSERT')).toContain('c2');
		expect(idsOf(qb.deltas, 'INSERT')).not.toContain('c2');

		qa.unsubscribe();
		qb.unsubscribe();
	});

	test('identical queries share a projection regardless of key order', async () => {
		const q1 = await subscribe({
			resource: 'posts',
			where: { status: 'a', rank: { $gte: 0 } },
			include: { author: true, comments: true },
		});
		const q2 = await subscribe({
			include: { comments: true, author: true },
			where: { rank: { $gte: 0 }, status: 'a' },
			resource: 'posts',
		});

		// One projection: root, author, and comments nodes.
		expect(testServer.queryEngine['queryNodes'].size).toBe(3);

		await storage.update(testSchema.users, 'u1', { name: 'Annie' });
		await settle();

		expect(idsOf(q1.deltas, 'UPDATE')).toEqual(['u1']);
		expect(idsOf(q2.deltas, 'UPDATE')).toEqual(['u1']);

		// Dropping one subscriber leaves the shared projection live for the other.
		q1.unsubscribe();
		await storage.update(testSchema.users, 'u1', { name: 'Anna' });
		await settle();

		expect(idsOf(q1.deltas, 'UPDATE')).toEqual(['u1']);
		expect(idsOf(q2.deltas, 'UPDATE')).toEqual(['u1', 'u1']);

		q2.unsubscribe();
	});
});
