import { z } from "zod";
import {
  createSchema,
  id,
  number,
  object,
  reference,
  string,
} from "../../src/schema";
import {
  router as createRouter,
  routeFactory,
} from "../../src/server/router";
import type { ServerDB, ServerCollection } from "../../src/server/storage";
import { describe, expectTypeOf, test } from "vitest";

const user = object("users", {
  id: id(),
  name: string(),
  email: string(),
  age: number(),
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

type TestSchema = typeof schema;

describe("routeFactory<TSchema>() - typed db in procedure handlers", () => {
  const typedRoute = routeFactory<TestSchema>();

  test("mutation handler db should have schema collection properties", () => {
    typedRoute.withProcedures(({ mutation }) => ({
      doSomething: mutation().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        expectTypeOf(db.users).toMatchTypeOf<
          ServerCollection<TestSchema["users"]>
        >();
        expectTypeOf(db.posts).toMatchTypeOf<
          ServerCollection<TestSchema["posts"]>
        >();
        return {};
      }),
    }));
  });

  test("query handler db should have schema collection properties", () => {
    typedRoute.withProcedures(({ query }) => ({
      findUsers: query().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        expectTypeOf(db.users).toMatchTypeOf<
          ServerCollection<TestSchema["users"]>
        >();
        return {};
      }),
    }));
  });

  test("mutation handler with input should have typed db", () => {
    typedRoute.withProcedures(({ mutation }) => ({
      createUser: mutation(z.object({ name: z.string() })).handler(
        async ({ db, req }) => {
          expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
          expectTypeOf(req.input).toEqualTypeOf<{ name: string }>();
          return {};
        },
      ),
    }));
  });

  test("query handler with input should have typed db", () => {
    typedRoute.withProcedures(({ query }) => ({
      search: query(z.object({ q: z.string() })).handler(
        async ({ db, req }) => {
          expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
          expectTypeOf(req.input).toEqualTypeOf<{ q: string }>();
          return {};
        },
      ),
    }));
  });

  test("db.users.insert should accept correct insert type", () => {
    typedRoute.withProcedures(({ mutation }) => ({
      create: mutation().handler(async ({ db }) => {
        const insertFn = db.users.insert;
        expectTypeOf(insertFn).parameter(0).toEqualTypeOf<{
          id: string;
          name: string;
          email: string;
          age: number;
        }>();
        return {};
      }),
    }));
  });

  test("db.posts.insert should accept correct insert type", () => {
    typedRoute.withProcedures(({ mutation }) => ({
      create: mutation().handler(async ({ db }) => {
        const insertFn = db.posts.insert;
        expectTypeOf(insertFn).parameter(0).toEqualTypeOf<{
          id: string;
          title: string;
          authorId: string;
        }>();
        return {};
      }),
    }));
  });

  test("db.users.update should accept correct update type", () => {
    typedRoute.withProcedures(({ mutation }) => ({
      edit: mutation().handler(async ({ db }) => {
        const updateFn = db.users.update;
        expectTypeOf(updateFn).parameter(0).toEqualTypeOf<string>();
        expectTypeOf(updateFn).parameter(1).toEqualTypeOf<{
          name?: string;
          email?: string;
          age?: number;
        }>();
        return {};
      }),
    }));
  });
});

describe("routeFactory<TSchema>() - procedure-only routes", () => {
  const typedRoute = routeFactory<TestSchema>();

  test("procedure-only route mutation handler should have typed db", () => {
    typedRoute.withProcedures(({ mutation }) => ({
      doSomething: mutation().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        expectTypeOf(db.users).toMatchTypeOf<
          ServerCollection<TestSchema["users"]>
        >();
        expectTypeOf(db.posts).toMatchTypeOf<
          ServerCollection<TestSchema["posts"]>
        >();
        return {};
      }),
    }));
  });

  test("procedure-only route query handler should have typed db", () => {
    typedRoute.withProcedures(({ query }) => ({
      getStats: query().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        return {};
      }),
    }));
  });
});

describe("routeFactory() without schema - backwards compatibility", () => {
  const untypedRoute = routeFactory();

  test("untyped route should have ServerDB<Schema<any>>", () => {
    untypedRoute
      
      .withProcedures(({ mutation }) => ({
        doSomething: mutation().handler(async ({ db }) => {
          expectTypeOf(db).toEqualTypeOf<
            ServerDB<ReturnType<typeof createSchema<Record<string, any>>>>
          >();
          return {};
        }),
      }));
  });
});

describe("routeFactory<TSchema>() - middleware chaining preserves schema type", () => {
  test("use() should preserve TSchema through middleware chain", () => {
    const typedFactory = routeFactory<TestSchema>().use(
      async ({ req, next }) => {
        return next(req);
      },
    );

    typedFactory
      
      .withProcedures(({ mutation }) => ({
        doSomething: mutation().handler(async ({ db }) => {
          expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
          return {};
        }),
      }));
  });

  test("multiple use() calls should preserve TSchema", () => {
    const typedFactory = routeFactory<TestSchema>()
      .use(async ({ req, next }) => next(req))
      .use(async ({ req, next }) => next(req));

    typedFactory.withProcedures(({ query }) => ({
      find: query().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        return {};
      }),
    }));
  });
});

describe("routeFactory<TSchema>() - detached routes compose into router", () => {
  const typedRoute = routeFactory<TestSchema>();

  const usersRoute = typedRoute
    
    .withProcedures(({ mutation, query }) => ({
      createUser: mutation(
        z.object({ name: z.string(), email: z.string() }),
      ).handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        return { id: "1" };
      }),
      getCount: query().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        return { count: 0 };
      }),
    }));

  const postsRoute = typedRoute.withProcedures(() => ({}));

  test("detached routes should be accepted by router()", () => {
    const testRouter = createRouter({
      schema,
      routes: {
        users: usersRoute,
        posts: postsRoute,
      },
    });

    expectTypeOf(testRouter).toHaveProperty("routes");
  });

  test("detached procedure-only route should be accepted by router()", () => {
    const analyticsRoute = typedRoute.withProcedures(({ query }) => ({
      getStats: query().handler(async ({ db }) => {
        expectTypeOf(db).toEqualTypeOf<ServerDB<TestSchema>>();
        return { total: 0 };
      }),
    }));

    const testRouter = createRouter({
      schema,
      routes: {
        users: typedRoute.withProcedures(() => ({})),
        posts: typedRoute.withProcedures(() => ({})),
        analytics: analyticsRoute,
      },
    });

    expectTypeOf(testRouter).toHaveProperty("routes");
  });
});
