import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Selectable } from "kysely";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	createRelations,
	createSchema,
	id,
	number,
	object,
	reference,
	string,
} from "../../src/schema";
import {
	defineHooks,
	mergeHooks,
	routeFactory,
	router,
	server,
	type Server,
} from "../../src/server";
import { SQLStorage } from "../../src/server/storage";

const group = object("groups", {
	id: id(),
	name: string(),
});

const card = object("cards", {
	id: id(),
	name: string(),
	counter: number(),
	groupId: reference("groups.id"),
});

const groupRelations = createRelations(group, ({ many }) => ({
	cards: many(card, "groupId"),
}));

const cardRelations = createRelations(card, ({ one }) => ({
	group: one(group, "groupId"),
}));

const schema = createSchema({
	group,
	card,
	groupRelations,
	cardRelations,
});

type TestContext = { role: "admin" | "user" };

describe("defineHooks", () => {
	test("returns the definition object untouched", () => {
		const def = defineHooks<typeof schema, TestContext>({
			groups: { beforeInsert: vi.fn() },
		});
		expect(def.groups?.beforeInsert).toBeDefined();
	});
});

describe("mergeHooks", () => {
	test("combines slices across different entities", () => {
		const a = defineHooks<typeof schema>({
			groups: { beforeInsert: vi.fn() },
		});
		const b = defineHooks<typeof schema>({
			cards: { afterInsert: vi.fn() },
		});
		const merged = mergeHooks(a, b);
		expect(merged.groups?.beforeInsert).toBeDefined();
		expect(merged.cards?.afterInsert).toBeDefined();
	});

	test("runs afterInsert handlers sequentially in argument order", async () => {
		const calls: string[] = [];
		const first = vi.fn(async () => {
			calls.push("first");
		});
		const second = vi.fn(async () => {
			calls.push("second");
		});
		const merged = mergeHooks<typeof schema>(
			{ groups: { afterInsert: first } },
			{ groups: { afterInsert: second } },
		);
		await merged.groups?.afterInsert?.({
			value: { id: "g1" } as any,
			rawValue: {} as any,
			db: {} as any,
		});
		expect(calls).toEqual(["first", "second"]);
	});

	test("beforeInsert chain threads transformed raw value to next handler", async () => {
		const seen: Array<Record<string, unknown>> = [];
		const first = vi.fn(async (opts: any) => {
			seen.push({ handler: "first", value: opts.value });
			return {
				value: { ...opts.rawValue.value, name: { value: "transformed" } },
			};
		});
		const second = vi.fn(async (opts: any) => {
			seen.push({ handler: "second", value: opts.value });
		});
		const merged = mergeHooks<typeof schema>(
			{ groups: { beforeInsert: first } },
			{ groups: { beforeInsert: second } },
		);

		const result = await merged.groups?.beforeInsert?.({
			value: { id: "g1", name: "original" } as any,
			rawValue: { value: { name: { value: "original" } } } as any,
			db: {} as any,
		});

		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
		expect((seen[1]?.value as { name: string }).name).toBe("transformed");
		expect(result).toBeDefined();
	});

	test("beforeInsert chain returns undefined when no handler transforms", async () => {
		const merged = mergeHooks<typeof schema>(
			{ groups: { beforeInsert: vi.fn(async () => {}) } },
			{ groups: { beforeInsert: vi.fn(async () => {}) } },
		);
		const result = await merged.groups?.beforeInsert?.({
			value: { id: "g1", name: "n" } as any,
			rawValue: { value: { name: { value: "n" } } } as any,
			db: {} as any,
		});
		expect(result).toBeUndefined();
	});
});

describe("Server hooks registry", () => {
	let db: Database.Database;
	let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;
	let storage: SQLStorage;
	let testServer: Server<any, any>;

	const publicRoute = routeFactory<typeof schema>();
	const testRouter = router({
		schema,
		routes: {
			groups: publicRoute.collectionRoute(schema.groups),
			cards: publicRoute.collectionRoute(schema.cards),
		},
	});

	const encode = (input: Record<string, unknown>) =>
		schema.groups.encodeMutation("set", input as any, new Date().toISOString());

	const insertGroup = (srv: Server<any, any>, id: string, name: string) =>
		srv.handleMutation({
			req: {
				type: "MUTATE",
				resource: "groups",
				resourceId: id,
				procedure: "INSERT",
				input: encode({ name }),
				headers: {},
				cookies: {},
				queryParams: {},
				context: {},
			},
		});

	const updateGroup = (srv: Server<any, any>, id: string, name: string) =>
		srv.handleMutation({
			req: {
				type: "MUTATE",
				resource: "groups",
				resourceId: id,
				procedure: "UPDATE",
				input: encode({ name }),
				headers: {},
				cookies: {},
				queryParams: {},
				context: {},
			},
		});

	beforeEach(async () => {
		db = new Database(":memory:");
		db.pragma("foreign_keys = ON");
		kyselyDb = new Kysely({
			dialect: new SqliteDialect({ database: db }),
		});
		storage = new SQLStorage(kyselyDb, schema);
		await storage.init(schema);
	});

	afterEach(async () => {
		await kyselyDb.destroy();
	});

	test("getHooks returns hooks from defineHooks", () => {
		const hooks = defineHooks<typeof schema>({
			groups: { beforeInsert: vi.fn() },
		});
		testServer = server({
			router: testRouter,
			storage,
			schema,
			hooks,
		});
		expect(testServer.getHooks("groups")).toBeDefined();
		expect(testServer.getHooks("cards")).toBeUndefined();
		expect(testServer.getHooks("nonexistent")).toBeUndefined();
	});

	test("beforeInsert and afterInsert fire on INSERT mutation", async () => {
		const beforeInsert = vi.fn();
		const afterInsert = vi.fn();
		testServer = server({
			router: testRouter,
			storage,
			schema,
			hooks: defineHooks<typeof schema>({
				groups: { beforeInsert, afterInsert },
			}),
		});

		await insertGroup(testServer, "g1", "Alpha");

		expect(beforeInsert).toHaveBeenCalledOnce();
		expect(afterInsert).toHaveBeenCalledOnce();
		const beforeArgs = beforeInsert.mock.calls[0]![0];
		expect(beforeArgs.value.id).toBe("g1");
		expect(beforeArgs.value.name).toBe("Alpha");
	});

	test("beforeUpdate and afterUpdate fire on UPDATE mutation", async () => {
		const beforeUpdate = vi.fn();
		const afterUpdate = vi.fn();
		testServer = server({
			router: testRouter,
			storage,
			schema,
			hooks: defineHooks<typeof schema>({
				groups: { beforeUpdate, afterUpdate },
			}),
		});

		await insertGroup(testServer, "g1", "Alpha");
		await updateGroup(testServer, "g1", "Beta");

		expect(beforeUpdate).toHaveBeenCalledOnce();
		expect(afterUpdate).toHaveBeenCalledOnce();
		const args = afterUpdate.mock.calls[0]![0];
		expect(args.previousValue?.name).toBe("Alpha");
		expect(args.value.name).toBe("Beta");
	});

	test("mergeHooks slices both run on the same mutation in order", async () => {
		const calls: string[] = [];
		const sliceA = defineHooks<typeof schema>({
			groups: {
				beforeInsert: async () => {
					calls.push("A");
				},
			},
		});
		const sliceB = defineHooks<typeof schema>({
			groups: {
				beforeInsert: async () => {
					calls.push("B");
				},
			},
		});
		testServer = server({
			router: testRouter,
			storage,
			schema,
			hooks: mergeHooks(sliceA, sliceB),
		});

		await insertGroup(testServer, "g1", "Alpha");

		expect(calls).toEqual(["A", "B"]);
	});

	test("V3 hooks chain with V2 route-level hooks (V2 runs first)", async () => {
		const calls: string[] = [];
		const v2Route = routeFactory<typeof schema>()
			.collectionRoute(schema.groups)
			.withHooks({
				beforeInsert: async () => {
					calls.push("v2");
				},
			});
		const mixedRouter = router({
			schema,
			routes: {
				groups: v2Route,
				cards: publicRoute.collectionRoute(schema.cards),
			},
		});

		testServer = server({
			router: mixedRouter,
			storage,
			schema,
			hooks: defineHooks<typeof schema>({
				groups: {
					beforeInsert: async () => {
						calls.push("v3");
					},
				},
			}),
		});

		await insertGroup(testServer, "g1", "Alpha");

		expect(calls).toEqual(["v2", "v3"]);
	});
});
