import { describe, expectTypeOf, test } from "vitest";
import {
	createSchema,
	id,
	object,
	reference,
	string,
} from "../../src/schema";
import {
	defineHooks,
	mergeHooks,
	type HooksRegistry,
} from "../../src/server/hooks";

const user = object("users", {
	id: id(),
	name: string(),
});

const post = object("posts", {
	id: id(),
	title: string(),
	authorId: reference("users.id"),
});

const schema = createSchema({
	users: user,
	posts: post,
});

type AppContext = { user: string; role: "admin" | "user" };

describe("defineHooks", () => {
	test("accepts schema entity keys", () => {
		const hooks = defineHooks<typeof schema, AppContext>({
			users: {
				beforeInsert: ({ ctx, value }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext | undefined>();
					expectTypeOf(value.id).toEqualTypeOf<string>();
				},
			},
			posts: {
				afterInsert: ({ value }) => {
					expectTypeOf(value.id).toEqualTypeOf<string>();
				},
			},
		});
		expectTypeOf(hooks).toEqualTypeOf<HooksRegistry<typeof schema, AppContext>>();
	});

	test("rejects unknown entity keys", () => {
		defineHooks<typeof schema, AppContext>({
			// @ts-expect-error not a schema entity
			widgets: { beforeInsert: () => {} },
		});
	});

	test("defaults TContext to Record<string, any>", () => {
		defineHooks<typeof schema>({
			users: {
				beforeInsert: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<Record<string, any> | undefined>();
				},
			},
		});
	});
});

describe("mergeHooks", () => {
	test("returns a HooksRegistry", () => {
		const a = defineHooks<typeof schema, AppContext>({
			users: { beforeInsert: () => {} },
		});
		const b = defineHooks<typeof schema, AppContext>({
			posts: { afterInsert: () => {} },
		});
		const merged = mergeHooks(a, b);
		expectTypeOf(merged).toEqualTypeOf<HooksRegistry<typeof schema, AppContext>>();
	});
});
