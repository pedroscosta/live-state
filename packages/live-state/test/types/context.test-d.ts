import {
	createSchema,
	id,
	object,
	reference,
	string,
} from "../../src/schema";
import {
	router as createRouter,
	routeFactory,
	createMiddleware,
	type TypedMiddleware,
	type Authorization,
	type Hooks,
	type ReadAuthorizationHandler,
	type MutationAuthorizationHandler,
} from "../../src/server/router";
import type {
	BaseRequest,
	ContextProvider,
	MutationRequest,
	QueryRequest,
} from "../../src/server";
import { describe, expectTypeOf, test } from "vitest";
import { z } from "zod";

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

describe("Typed Context", () => {
	describe("Phase 1: BaseRequest and related types", () => {
		test("BaseRequest context is typed", () => {
			type Req = BaseRequest<AppContext>;
			expectTypeOf<Req["context"]>().toEqualTypeOf<AppContext>();
		});

		test("BaseRequest defaults to Record<string, any>", () => {
			type Req = BaseRequest;
			expectTypeOf<Req["context"]>().toEqualTypeOf<Record<string, any>>();
		});

		test("QueryRequest propagates TContext", () => {
			type Req = QueryRequest<AppContext>;
			expectTypeOf<Req["context"]>().toEqualTypeOf<AppContext>();
		});

		test("MutationRequest propagates TContext", () => {
			type Req = MutationRequest<any, AppContext>;
			expectTypeOf<Req["context"]>().toEqualTypeOf<AppContext>();
		});

		test("ContextProvider returns TContext", () => {
			type CP = ContextProvider<AppContext>;
			expectTypeOf<CP>().toBeFunction();
		});
	});

	describe("Phase 1: Authorization handlers receive TContext", () => {
		test("ReadAuthorizationHandler ctx is typed", () => {
			type Handler = ReadAuthorizationHandler<typeof user, AppContext>;
			expectTypeOf<Parameters<Handler>[0]["ctx"]>().toEqualTypeOf<AppContext>();
		});

		test("MutationAuthorizationHandler ctx is typed", () => {
			type Handler = MutationAuthorizationHandler<typeof user, AppContext>;
			expectTypeOf<Parameters<Handler>[0]["ctx"]>().toEqualTypeOf<AppContext>();
		});

		test("Authorization propagates TContext", () => {
			type Auth = Authorization<typeof user, AppContext>;
			const auth: Auth = {
				read: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext>();
					return true;
				},
				insert: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext>();
					return true;
				},
			};
		});
	});

	describe("Phase 1: Hooks receive TContext", () => {
		test("Hooks ctx is typed", () => {
			type H = Hooks<typeof user, typeof schema, AppContext>;
			const hooks: H = {
				beforeInsert: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext | undefined>();
				},
				afterInsert: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext | undefined>();
				},
				beforeUpdate: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext | undefined>();
				},
				afterUpdate: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext | undefined>();
				},
			};
		});
	});

	describe("Phase 1: RouteFactory flows TContext to Route", () => {
		test("collectionRoute authorization receives TContext", () => {
			const factory = routeFactory<typeof schema, AppContext>();

			factory.collectionRoute(schema.posts, {
				read: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext>();
					return { authorId: ctx.user };
				},
				insert: ({ ctx, value }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext>();
					return true;
				},
			});
		});

		test("default TContext is Record<string, any>", () => {
			const factory = routeFactory<typeof schema>();

			factory.collectionRoute(schema.posts, {
				read: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<Record<string, any>>();
					return true;
				},
			});
		});

		test("withProcedures receives TContext in procedure handlers", () => {
			const factory = routeFactory<typeof schema, AppContext>();

			factory.collectionRoute(schema.users).withProcedures(({ mutation, query }) => ({
				createUser: mutation(z.object({ name: z.string() })).handler(({ req }) => {
					expectTypeOf(req.context).toEqualTypeOf<AppContext>();
					return { success: true };
				}),
				getUser: query(z.object({ id: z.string() })).handler(({ req }) => {
					expectTypeOf(req.context).toEqualTypeOf<AppContext>();
					return { id: req.input.id };
				}),
			}));
		});

		test("RouteFactory.withProcedures receives TContext in procedure handlers", () => {
			const factory = routeFactory<typeof schema, AppContext>();

			factory.withProcedures(({ mutation, query }) => ({
				health: query().handler(({ req }) => {
					expectTypeOf(req.context).toEqualTypeOf<AppContext>();
					return { status: "ok" };
				}),
			}));
		});

		test("use() preserves TContext for plain middleware", () => {
			const factory = routeFactory<typeof schema, AppContext>();
			const withMiddleware = factory.use(async ({ req, next }) => next(req));

			withMiddleware.collectionRoute(schema.posts, {
				read: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<AppContext>();
					return true;
				},
			});
		});
	});

	describe("Phase 2: TypedMiddleware transforms context", () => {
		test("createMiddleware produces TypedMiddleware", () => {
			const mw = createMiddleware<{ user?: string }, { user: string }>(
				({ ctx, next }) => {
					if (!ctx.user) throw new Error("Unauthorized");
					return next({ user: ctx.user });
				},
			);

			expectTypeOf(mw).toMatchTypeOf<TypedMiddleware<{ user?: string }, { user: string }>>();
		});

		test("use() with TypedMiddleware transforms context", () => {
			const authMiddleware = createMiddleware<{ user?: string }, { user: string }>(
				({ ctx, next }) => {
					if (!ctx.user) throw new Error("Unauthorized");
					return next({ user: ctx.user });
				},
			);

			const factory = routeFactory<typeof schema, { user?: string }>();
			const protectedFactory = factory.use(authMiddleware);

			protectedFactory.collectionRoute(schema.posts, {
				read: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<{ user: string }>();
					return { authorId: ctx.user };
				},
			});
		});

		test("chained TypedMiddleware transforms accumulate", () => {
			const mw1 = createMiddleware<Record<string, any>, { user: string }>(
				({ next }) => next({ user: "test" }),
			);
			const mw2 = createMiddleware<{ user: string }, { user: string; org: string }>(
				({ ctx, next }) => next({ ...ctx, org: "test-org" }),
			);

			const factory = routeFactory<typeof schema>()
				.use(mw1)
				.use(mw2);

			factory.collectionRoute(schema.posts, {
				read: ({ ctx }) => {
					expectTypeOf(ctx).toEqualTypeOf<{ user: string; org: string }>();
					return true;
				},
			});
		});
	});
});
