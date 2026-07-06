/**
 * End-to-end tests for windowed `include`s: each parent keeps its own bounded
 * window (e.g. every project showing its latest N tasks). A child write is
 * routed to the affected parent's window via its foreign key, and re-parenting
 * decomposes into a scope-out on the old parent (with backfill) plus a scope-in
 * on the new one. See ADR-0003 / issue #186.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
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
import { generateId } from '../../src/core/utils';
import { LogLevel } from '../../src/utils';

const project = object('projects', {
	id: id(),
	name: string(),
	status: string(),
});

const task = object('tasks', {
	id: id(),
	title: string(),
	priority: number(),
	projectId: reference('projects.id'),
});

const projectRelations = createRelations(project, ({ many }) => ({
	tasks: many(task, 'projectId'),
}));

const taskRelations = createRelations(task, ({ one }) => ({
	project: one(project, 'projectId'),
}));

const testSchema = createSchema({
	projects: project,
	tasks: task,
	projectRelations,
	taskRelations,
});

const publicRoute = routeFactory();

const testRouter = router({
	schema: testSchema,
	routes: {
		projects: publicRoute.withProcedures(() => ({})),
		tasks: publicRoute.withProcedures(() => ({})),
	},
});

describe('Windowed includes (per-parent windows)', () => {
	let storage: SQLStorage;
	let testServer: ReturnType<typeof server>;
	let db: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;

	// Tracked (active) parents plus one archived parent that the root query
	// filters out, so a re-parent *to* it is a plain removal from a tracked list.
	let projectA: string;
	let projectB: string;
	let projectC: string;
	let projectArchived: string;

	// projectA tasks by priority: a5(50) a4(40) a3(30) a2(20) a1(10).
	const aTasks: { id: string; priority: number }[] = [];
	// projectB tasks by priority: b2(15) b1(5).
	const bTasks: { id: string; priority: number }[] = [];

	const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

	// Drive the query engine directly (the inbound Default Query path was removed
	// with ADR-0002); this mirrors the shim used by query-engine.test.ts.
	const handleQuery = async (opts: {
		// biome-ignore lint/suspicious/noExplicitAny: test shim mirrors the old request shape
		req: any;
		// biome-ignore lint/suspicious/noExplicitAny: test shim mirrors the SyncDelta callback
		subscription?: (mutation: any) => void;
	}) => {
		const { type: _type, ...query } = opts.req;
		const ctx = { headers: {}, cookies: {}, queryParams: {}, context: {} };
		const unsubscribe = opts.subscription
			? testServer.queryEngine.subscribe(query, opts.subscription, ctx)
			: undefined;
		const data = await testServer.queryEngine.get(query, { context: ctx });
		return { data, unsubscribe };
	};

	const insertTask = (
		id: string,
		projectId: string,
		priority: number,
		title = `task-${priority}`,
	) => storage.insert(testSchema.tasks, { id, title, priority, projectId });

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

		projectA = generateId();
		projectB = generateId();
		projectC = generateId();
		projectArchived = generateId();

		await storage.insert(testSchema.projects, {
			id: projectA,
			name: 'A',
			status: 'active',
		});
		await storage.insert(testSchema.projects, {
			id: projectB,
			name: 'B',
			status: 'active',
		});
		await storage.insert(testSchema.projects, {
			id: projectC,
			name: 'C',
			status: 'active',
		});
		await storage.insert(testSchema.projects, {
			id: projectArchived,
			name: 'Archived',
			status: 'archived',
		});

		aTasks.length = 0;
		for (const priority of [10, 20, 30, 40, 50]) {
			const tid = generateId();
			await insertTask(tid, projectA, priority);
			aTasks.push({ id: tid, priority });
		}

		bTasks.length = 0;
		for (const priority of [5, 15]) {
			const tid = generateId();
			await insertTask(tid, projectB, priority);
			bTasks.push({ id: tid, priority });
		}
	});

	afterEach(async () => {
		await kyselyDb.destroy();
	});

	const taskById = (list: typeof aTasks, priority: number) =>
		list.find((t) => t.priority === priority)!.id;

	// project → latest-3-tasks (by priority desc), across active projects only.
	const subscribeLatest3 = (mutations: any[]) =>
		handleQuery({
			req: {
				type: 'QUERY',
				resource: 'projects',
				where: { status: 'active' },
				include: {
					tasks: { limit: 3, orderBy: [{ key: 'priority', direction: 'desc' }] },
				},
			},
			subscription: (m) => mutations.push(m),
		});

	const windowIds = (data: any[], projectId: string): string[] => {
		const parent = data.find((p: any) => p.value.id.value === projectId);
		const tasks = parent?.value?.tasks?.value ?? [];
		return tasks.map((t: any) => t.value.id.value);
	};

	test('seeds each parent window independently to its own top-N', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		// projectA is full at its top-3; projectB keeps both of its tasks.
		expect(windowIds(result.data, projectA)).toEqual([
			taskById(aTasks, 50),
			taskById(aTasks, 40),
			taskById(aTasks, 30),
		]);
		expect(windowIds(result.data, projectB)).toEqual([
			taskById(bTasks, 15),
			taskById(bTasks, 5),
		]);
		expect(windowIds(result.data, projectC)).toEqual([]);

		result.unsubscribe?.();
	});

	test('adding a child to a full per-parent window emits INSERT + eviction DELETE scoped to that parent', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		const getSpy = vi.spyOn(storage, 'get');

		// New top task for A: enters A's window, evicts A's boundary (a3, priority 30).
		const newTask = generateId();
		await insertTask(newTask, projectA, 60);
		await settle();

		const insert = mutations.find((m) => m.resourceId === newTask);
		expect(insert?.op).toBe('INSERT');
		expect(insert?.payload.priority.value).toBe(60);

		const evict = mutations.find(
			(m) => m.resourceId === taskById(aTasks, 30) && m.op === 'DELETE',
		);
		expect(evict).toBeDefined();
		expect(evict.payload).toEqual({});

		// Eviction is resolved from the in-memory window: no boundary read.
		expect(getSpy).not.toHaveBeenCalled();

		// projectB is untouched by a write to projectA's window.
		expect(
			mutations.some((m) => bTasks.some((t) => t.id === m.resourceId)),
		).toBe(false);

		getSpy.mockRestore();
		result.unsubscribe?.();
	});

	test('adding a child to a non-full per-parent window emits INSERT with no eviction', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		const newTask = generateId();
		await insertTask(newTask, projectB, 25);
		await settle();

		const insert = mutations.find((m) => m.resourceId === newTask);
		expect(insert?.op).toBe('INSERT');
		expect(mutations.some((m) => m.op === 'DELETE')).toBe(false);

		result.unsubscribe?.();
	});

	test('a field change that leaves the row in the same tracked list emits a plain UPDATE', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		const getSpy = vi.spyOn(storage, 'get');

		// A visible task's title changes; it stays in A's window.
		await storage.update(testSchema.tasks, taskById(aTasks, 50), {
			title: 'renamed',
		});
		await settle();

		const deltas = mutations.filter(
			(m) => m.resourceId === taskById(aTasks, 50),
		);
		expect(deltas.length).toBeGreaterThan(0);
		expect(deltas.every((m) => m.op === 'UPDATE')).toBe(true);
		expect(mutations.some((m) => m.op === 'INSERT' || m.op === 'DELETE')).toBe(
			false,
		);
		expect(getSpy).not.toHaveBeenCalled();

		getSpy.mockRestore();
		result.unsubscribe?.();
	});

	test('re-parenting A→B emits DELETE + backfill on A and INSERT on B; unrelated parents untouched', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		const a5 = taskById(aTasks, 50);
		// Move the top task of A into B.
		await storage.update(testSchema.tasks, a5, { projectId: projectB });
		await settle();

		// Scope-out from A.
		const del = mutations.find((m) => m.resourceId === a5 && m.op === 'DELETE');
		expect(del).toBeDefined();
		expect(del.payload).toEqual({});

		// A backfills its freed slot from the next row past its boundary: a2 (20).
		const backfill = mutations.find(
			(m) => m.resourceId === taskById(aTasks, 20) && m.op === 'INSERT',
		);
		expect(backfill).toBeDefined();
		expect(backfill.payload.priority.value).toBe(20);

		// Scope-in to B (payload from the row's own mutation).
		const scopeIn = mutations.filter(
			(m) => m.resourceId === a5 && m.op === 'INSERT',
		);
		expect(scopeIn.length).toBe(1);

		// projectC never held this row and is untouched.
		expect(mutations.some((m) => m.resourceId === projectC)).toBe(false);

		result.unsubscribe?.();
	});

	test('removing a child (re-parenting to an untracked parent) emits DELETE + backfill, no INSERT', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		const a4 = taskById(aTasks, 40);
		// Move a visible task out to the archived (untracked) project.
		await storage.update(testSchema.tasks, a4, { projectId: projectArchived });
		await settle();

		const del = mutations.find((m) => m.resourceId === a4 && m.op === 'DELETE');
		expect(del).toBeDefined();

		// A backfills from the next row past its boundary: a2 (20).
		const backfill = mutations.find(
			(m) => m.resourceId === taskById(aTasks, 20) && m.op === 'INSERT',
		);
		expect(backfill).toBeDefined();

		// The row scoped into no tracked window, so it is never re-inserted.
		expect(mutations.some((m) => m.resourceId === a4 && m.op === 'INSERT')).toBe(
			false,
		);

		result.unsubscribe?.();
	});

	test('covers add, remove, and re-parent against project → latest-3-tasks', async () => {
		const mutations: any[] = [];
		const result = await subscribeLatest3(mutations);

		// Add: new top task for C (empty window) — INSERT, no eviction.
		const c1 = generateId();
		await insertTask(c1, projectC, 100);
		await settle();
		expect(mutations.find((m) => m.resourceId === c1)?.op).toBe('INSERT');

		// Re-parent: A's top task moves to C.
		const a5 = taskById(aTasks, 50);
		mutations.length = 0;
		await storage.update(testSchema.tasks, a5, { projectId: projectC });
		await settle();
		expect(
			mutations.find((m) => m.resourceId === a5 && m.op === 'DELETE'),
		).toBeDefined();
		expect(
			mutations.find((m) => m.resourceId === a5 && m.op === 'INSERT'),
		).toBeDefined();
		// A backfills from a2 (20); a4/a3 were already visible.
		expect(
			mutations.find(
				(m) => m.resourceId === taskById(aTasks, 20) && m.op === 'INSERT',
			),
		).toBeDefined();

		// Remove: send a visible C task to the archived project.
		mutations.length = 0;
		await storage.update(testSchema.tasks, c1, { projectId: projectArchived });
		await settle();
		expect(
			mutations.find((m) => m.resourceId === c1 && m.op === 'DELETE'),
		).toBeDefined();
		expect(mutations.some((m) => m.resourceId === c1 && m.op === 'INSERT')).toBe(
			false,
		);

		result.unsubscribe?.();
	});
});
