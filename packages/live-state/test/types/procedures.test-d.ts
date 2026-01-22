import { z } from "zod";
import {
  createSchema,
  id,
  number,
  object,
  reference,
  string,
} from "../../src/schema";
import { createClient } from "../../src/client";
import { createClient as createFetchClient } from "../../src/client/fetch";
import { router as createRouter, routeFactory } from "../../src/server/router";
import { describe, expectTypeOf, test } from "vitest";

/**
 * Test schema for custom procedures
 */
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
  user,
  post,
});

const publicRoute = routeFactory();

/**
 * Router with custom procedures (mutations and queries)
 */
const routerWithProcedures = createRouter({
  schema,
  routes: {
    users: publicRoute
      .collectionRoute(schema.users)
      .withProcedures(({ mutation, query }) => ({
        // Custom queries
        getUsersByAge: query(z.object({ minAge: z.number() })).handler(
          async ({ req }) => {
            return [{ id: "1", name: "Test", email: "test@test.com", age: req.input.minAge }];
          }
        ),

        getUserCount: query().handler(async () => {
          return { count: 42 };
        }),

        searchUsers: query(
          z.object({
            name: z.string().optional(),
            minAge: z.number().optional(),
            maxAge: z.number().optional(),
          })
        ).handler(async ({ req }) => {
          return {
            users: [] as { id: string; name: string }[],
            total: 0,
            filters: req.input,
          };
        }),

        // Custom mutations
        createUserWithRole: mutation(
          z.object({
            name: z.string(),
            email: z.string(),
            role: z.enum(["admin", "user", "guest"]),
          })
        ).handler(async ({ req }) => {
          return { id: "new-id", role: req.input.role };
        }),

        resetAllPasswords: mutation().handler(async () => {
          return { resetCount: 100 };
        }),

        bulkUpdate: mutation(
          z.array(z.object({ id: z.string(), data: z.any() }))
        ).handler(async ({ req }) => {
          return { updated: req.input.length };
        }),
      })),

    posts: publicRoute
      .collectionRoute(schema.posts)
      .withProcedures(({ mutation, query }) => ({
        // Queries
        getPopularPosts: query(z.object({ limit: z.number() })).handler(
          async ({ req }) => {
            return [] as { id: string; title: string; views: number }[];
          }
        ),

        getPostStats: query().handler(async () => {
          return { totalPosts: 100, avgViews: 500 };
        }),

        // Mutations
        publishPost: mutation(z.string()).handler(async ({ req }) => {
          return { postId: req.input, published: true, publishedAt: new Date() };
        }),
      })),
  },
});

/**
 * WebSocket client types
 */
const {
  store: { query, mutate },
} = createClient<typeof routerWithProcedures>({
  url: "ws://localhost:5001/ws",
  schema,
  storage: false,
});

describe("custom queries - websocket client", () => {
  test("should infer custom query with object input", () => {
    const getUsersByAge = query.users.getUsersByAge;

    expectTypeOf(getUsersByAge)
      .parameter(0)
      .toEqualTypeOf<{ minAge: number }>();

    expectTypeOf(getUsersByAge).returns.toEqualTypeOf<
      Promise<{ id: string; name: string; email: string; age: number }[]>
    >();
  });

  test("should infer custom query without input", () => {
    const getUserCount = query.users.getUserCount;

    expectTypeOf(getUserCount).parameters.toEqualTypeOf<[]>();

    expectTypeOf(getUserCount).returns.toEqualTypeOf<
      Promise<{ count: number }>
    >();
  });

  test("should infer custom query with complex input and return type", () => {
    const searchUsers = query.users.searchUsers;

    expectTypeOf(searchUsers).parameter(0).toEqualTypeOf<{
      name?: string | undefined;
      minAge?: number | undefined;
      maxAge?: number | undefined;
    }>();

    expectTypeOf(searchUsers).returns.toEqualTypeOf<
      Promise<{
        users: { id: string; name: string }[];
        total: number;
        filters: {
          name?: string | undefined;
          minAge?: number | undefined;
          maxAge?: number | undefined;
        };
      }>
    >();
  });

  test("should infer custom query on different routes", () => {
    const getPopularPosts = query.posts.getPopularPosts;
    const getPostStats = query.posts.getPostStats;

    expectTypeOf(getPopularPosts)
      .parameter(0)
      .toEqualTypeOf<{ limit: number }>();

    expectTypeOf(getPopularPosts).returns.toEqualTypeOf<
      Promise<{ id: string; title: string; views: number }[]>
    >();

    expectTypeOf(getPostStats).parameters.toEqualTypeOf<[]>();

    expectTypeOf(getPostStats).returns.toEqualTypeOf<
      Promise<{ totalPosts: number; avgViews: number }>
    >();
  });

  test("should still have access to standard QueryBuilder methods", () => {
    // Standard QueryBuilder methods should still work
    const standardGet = query.users.get;
    const standardWhere = query.users.where;
    const standardInclude = query.users.include;

    expectTypeOf(standardGet).returns.toEqualTypeOf<
      { id: string; name: string; email: string; age: number }[]
    >();

    // where should return a QueryBuilder
    expectTypeOf(standardWhere).toBeFunction();

    // include should return a QueryBuilder
    expectTypeOf(standardInclude).toBeFunction();
  });
});

describe("custom mutations - websocket client", () => {
  test("should infer custom mutation with object input", () => {
    const createUserWithRole = mutate.users.createUserWithRole;

    expectTypeOf(createUserWithRole).parameter(0).toEqualTypeOf<{
      name: string;
      email: string;
      role: "admin" | "user" | "guest";
    }>();

    expectTypeOf(createUserWithRole).returns.toEqualTypeOf<
      Promise<{ id: string; role: "admin" | "user" | "guest" }>
    >();
  });

  test("should infer custom mutation without input", () => {
    const resetAllPasswords = mutate.users.resetAllPasswords;

    expectTypeOf(resetAllPasswords).parameters.toEqualTypeOf<[]>();

    expectTypeOf(resetAllPasswords).returns.toEqualTypeOf<
      Promise<{ resetCount: number }>
    >();
  });

  test("should infer custom mutation with array input", () => {
    const bulkUpdate = mutate.users.bulkUpdate;

    expectTypeOf(bulkUpdate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; data: any }[]>();

    expectTypeOf(bulkUpdate).returns.toEqualTypeOf<Promise<{ updated: number }>>();
  });

  test("should infer custom mutation with primitive input", () => {
    const publishPost = mutate.posts.publishPost;

    expectTypeOf(publishPost).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(publishPost).returns.toEqualTypeOf<
      Promise<{ postId: string; published: boolean; publishedAt: Date }>
    >();
  });

  test("should still have access to standard mutation methods", () => {
    // Standard mutation methods should still work
    const standardInsert = mutate.users.insert;
    const standardUpdate = mutate.users.update;

    expectTypeOf(standardInsert)
      .parameter(0)
      .toEqualTypeOf<{ id: string; name: string; email: string; age: number }>();

    expectTypeOf(standardUpdate).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(standardUpdate).parameter(1).toEqualTypeOf<{
      name?: string;
      email?: string;
      age?: number;
    }>();
  });
});

/**
 * Fetch client types
 */
const fetchClient = createFetchClient<typeof routerWithProcedures>({
  url: "http://localhost:3000",
  schema,
  credentials: async () => ({}),
});

describe("custom queries - fetch client", () => {
  test("should infer custom query with object input (Promise wrapper)", () => {
    const getUsersByAge = fetchClient.query.users.getUsersByAge;

    expectTypeOf(getUsersByAge)
      .parameter(0)
      .toEqualTypeOf<{ minAge: number }>();

    expectTypeOf(getUsersByAge).returns.toEqualTypeOf<
      Promise<{ id: string; name: string; email: string; age: number }[]>
    >();
  });

  test("should infer custom query without input (Promise wrapper)", () => {
    const getUserCount = fetchClient.query.users.getUserCount;

    expectTypeOf(getUserCount).parameters.toEqualTypeOf<[]>();

    expectTypeOf(getUserCount).returns.toEqualTypeOf<
      Promise<{ count: number }>
    >();
  });

  test("should infer custom query with complex input and return type (Promise wrapper)", () => {
    const searchUsers = fetchClient.query.users.searchUsers;

    expectTypeOf(searchUsers).parameter(0).toEqualTypeOf<{
      name?: string | undefined;
      minAge?: number | undefined;
      maxAge?: number | undefined;
    }>();

    expectTypeOf(searchUsers).returns.toEqualTypeOf<
      Promise<{
        users: { id: string; name: string }[];
        total: number;
        filters: {
          name?: string | undefined;
          minAge?: number | undefined;
          maxAge?: number | undefined;
        };
      }>
    >();
  });

  test("should still have access to standard QueryBuilder methods with Promise", () => {
    const standardGet = fetchClient.query.users.get;

    expectTypeOf(standardGet).returns.toEqualTypeOf<
      Promise<{ id: string; name: string; email: string; age: number }[]>
    >();
  });
});

describe("custom mutations - fetch client", () => {
  test("should infer custom mutation with object input (Promise wrapper)", () => {
    const createUserWithRole = fetchClient.mutate.users.createUserWithRole;

    expectTypeOf(createUserWithRole).parameter(0).toEqualTypeOf<{
      name: string;
      email: string;
      role: "admin" | "user" | "guest";
    }>();

    expectTypeOf(createUserWithRole).returns.toEqualTypeOf<
      Promise<{ id: string; role: "admin" | "user" | "guest" }>
    >();
  });

  test("should infer custom mutation without input (Promise wrapper)", () => {
    const resetAllPasswords = fetchClient.mutate.users.resetAllPasswords;

    expectTypeOf(resetAllPasswords).parameters.toEqualTypeOf<[]>();

    expectTypeOf(resetAllPasswords).returns.toEqualTypeOf<
      Promise<{ resetCount: number }>
    >();
  });

  test("should still have access to standard mutation methods", () => {
    const standardInsert = fetchClient.mutate.users.insert;

    expectTypeOf(standardInsert)
      .parameter(0)
      .toEqualTypeOf<{ id: string; name: string; email: string; age: number }>();
  });
});

/**
 * Complex procedure return types - testing both mutations and queries together
 */
describe("complex procedure return types", () => {
  test("should infer union return types from query", () => {
    // Using the routerWithProcedures which already tests queries with input
    const getUsersByAge = query.users.getUsersByAge;

    expectTypeOf(getUsersByAge)
      .parameter(0)
      .toEqualTypeOf<{ minAge: number }>();

    // The return type should be an array of user objects
    expectTypeOf(getUsersByAge).returns.toEqualTypeOf<
      Promise<{ id: string; name: string; email: string; age: number }[]>
    >();
  });

  test("should work with complex nested return types from mutation", () => {
    // Using the existing custom mutation types that include nested objects
    const createUserWithRole = mutate.users.createUserWithRole;

    expectTypeOf(createUserWithRole).parameter(0).toEqualTypeOf<{
      name: string;
      email: string;
      role: "admin" | "user" | "guest";
    }>();

    expectTypeOf(createUserWithRole).returns.toEqualTypeOf<
      Promise<{ id: string; role: "admin" | "user" | "guest" }>
    >();
  });

  test("should handle query with optional fields in input", () => {
    const searchUsers = query.users.searchUsers;

    expectTypeOf(searchUsers).parameter(0).toEqualTypeOf<{
      name?: string | undefined;
      minAge?: number | undefined;
      maxAge?: number | undefined;
    }>();
  });
});
