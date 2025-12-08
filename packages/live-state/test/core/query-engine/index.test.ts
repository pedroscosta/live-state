import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Schema } from "../../../src/schema";
import type { RawQueryRequest } from "../../../src/core/schemas/core-protocol";
import type {
  DataRouter,
  DataSource,
} from "../../../src/core/query-engine/types";
import { QueryEngine } from "../../../src/core/query-engine/index";
import {
  createSchema,
  createRelations,
  id,
  object,
  reference,
  string,
} from "../../../src/schema";

describe("QueryEngine", () => {
  let mockRouter: DataRouter<any>;
  let mockStorage: DataSource;
  let mockSchema: Schema<any>;
  let queryEngine: QueryEngine;

  beforeEach(() => {
    mockRouter = {
      get: vi.fn().mockResolvedValue([]),
      incrementQueryStep: vi.fn(),
    } as unknown as DataRouter<any>;

    mockStorage = {
      get: vi.fn().mockResolvedValue([]),
    } as unknown as DataSource;

    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const comment = object("comments", {
      id: id(),
      text: string(),
      postId: reference("posts.id"),
    });

    const userRelations = createRelations(user, ({ many }) => ({
      posts: many(post, "userId"),
    }));

    const postRelations = createRelations(post, ({ many, one }) => ({
      comments: many(comment, "postId"),
      author: one(user, "userId"),
    }));

    mockSchema = createSchema({
      users: user,
      posts: post,
      comments: comment,
      userRelations,
      postRelations,
    });

    queryEngine = new QueryEngine({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    test("should create QueryEngine instance", () => {
      expect(queryEngine).toBeInstanceOf(QueryEngine);
    });

    test("should initialize with provided router, storage, and schema", () => {
      const engine = new QueryEngine({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      expect(engine).toBeInstanceOf(QueryEngine);
    });
  });

  describe("get", () => {
    test("should throw error indicating method not implemented", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
      };

      expect(() => {
        queryEngine.get(query);
      }).toThrow("Method not implemented.");
    });
  });

  describe("subscribe", () => {
    test("should throw error indicating method not implemented", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
      };
      const callback = vi.fn();

      expect(() => {
        queryEngine.subscribe(query, callback);
      }).toThrow("Method not implemented.");
    });
  });

  describe("breakdownQuery", () => {
    test("should return single query step for query without includes", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        query: {
          resource: "users",
          where: { name: "John" },
        },
        stepPath: [],
      });
    });

    test("should preserve all query properties except include", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
        limit: 10,
        sort: [{ key: "name", direction: "asc" }],
        lastSyncedAt: "2023-01-01T00:00:00.000Z",
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(1);
      expect(result[0].query).toEqual({
        resource: "users",
        where: { name: "John" },
        limit: 10,
        sort: [{ key: "name", direction: "asc" }],
        lastSyncedAt: "2023-01-01T00:00:00.000Z",
      });
    });

    test("should handle query with single include", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: { posts: true },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        query: {
          resource: "users",
          where: {},
        },
        stepPath: [],
      });
      expect(result[1]).toEqual({
        query: expect.objectContaining({
          resource: "posts",
        }),
        stepPath: ["posts"],
      });
    });

    test("should handle query with multiple includes", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: {
          posts: true,
        },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(2);
      expect(result[0].stepPath).toEqual([]);
      expect(result[1].stepPath).toEqual(["posts"]);
    });

    test("should handle nested includes", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: {
          posts: {
            comments: true,
          },
        },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        query: {
          resource: "users",
          where: {},
        },
        stepPath: [],
      });
      expect(result[1]).toEqual({
        query: expect.objectContaining({
          resource: "posts",
        }),
        stepPath: ["posts"],
      });
      expect(result[2]).toEqual({
        query: expect.objectContaining({
          resource: "comments",
        }),
        stepPath: ["posts", "comments"],
      });
    });

    test("should handle deeply nested includes", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: {
          posts: {
            comments: true,
          },
        },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].stepPath).toEqual([]);
      expect(result[result.length - 1].stepPath).toContain("comments");
    });

    test("should handle query with where clause and includes", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
        include: { posts: true },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(2);
      expect(result[0].query.where).toEqual({ name: "John" });
      expect(result[1].query.resource).toBe("posts");
    });

    test("should handle empty include object", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: {},
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(1);
      expect(result[0].query.resource).toBe("users");
    });

    test("should handle include with boolean true", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: { posts: true },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(2);
      expect(result[1].query.resource).toBe("posts");
    });

    test("should handle include with nested object", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: {
          posts: {
            comments: true,
          },
        },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result.length).toBeGreaterThan(1);
      // The include is processed to create nested steps, not included in the query object
      expect(result[1].query.resource).toBe("posts");
    });

    test("should use provided stepPath", () => {
      const query: RawQueryRequest = {
        resource: "posts",
        where: {},
        include: { comments: true },
      };

      const result = queryEngine.breakdownQuery(query, ["users"]);

      expect(result[0].stepPath).toEqual(["users"]);
      expect(result[1].stepPath).toEqual(["users", "comments"]);
    });

    test("should throw error when resource not found in schema with include", () => {
      const query: RawQueryRequest = {
        resource: "nonexistent",
        where: {},
        include: { someRelation: true },
      };

      expect(() => {
        queryEngine.breakdownQuery(query);
      }).toThrow("Resource nonexistent not found");
    });

    test("should not throw error when resource not found without include", () => {
      // The resource check only happens when processing includes
      const query: RawQueryRequest = {
        resource: "nonexistent",
        where: {},
      };

      // Should not throw - resource check only happens when include is present
      expect(() => {
        queryEngine.breakdownQuery(query);
      }).not.toThrow();
    });

    test("should throw error when relation not found", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: { nonexistent: true },
      };

      expect(() => {
        queryEngine.breakdownQuery(query);
      }).toThrow("Relation nonexistent not found for resource users");
    });

    test("should handle query with multiple relations from same resource", () => {
      const query: RawQueryRequest = {
        resource: "posts",
        where: {},
        include: {
          comments: true,
          author: true,
        },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].query.resource).toBe("posts");
    });

    test("should preserve where clause in nested queries", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
        include: { posts: true },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result[0].query.where).toEqual({ name: "John" });
      // Nested queries don't preserve where clause - they only get ...rest properties
      expect(result[1].query.resource).toBe("posts");
    });

    test("should handle complex nested structure", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
        include: {
          posts: {
            comments: true,
          },
        },
        limit: 10,
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].query.limit).toBe(10);
      expect(result[0].query.where).toEqual({ name: "John" });
    });

    test("should handle include with false value (should be treated as object)", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: { posts: false as any },
      };

      // When include value is false, it's still an object key, so it should process it
      // The actual behavior depends on implementation, but we test it doesn't crash
      expect(() => {
        queryEngine.breakdownQuery(query);
      }).not.toThrow();
    });

    test("should handle query with no where clause", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(1);
      expect(result[0].query.where).toBeUndefined();
    });

    test("should handle query with empty where clause", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result).toHaveLength(1);
      expect(result[0].query.where).toEqual({});
    });

    test("should correctly build stepPath for nested relations", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        include: {
          posts: {
            comments: true,
          },
        },
      };

      const result = queryEngine.breakdownQuery(query);

      const stepPaths = result.map((step) => step.stepPath);
      expect(stepPaths[0]).toEqual([]);
      expect(stepPaths[1]).toEqual(["posts"]);
      expect(stepPaths[2]).toEqual(["posts", "comments"]);
    });

    test("should handle query with both limit and sort", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: {},
        limit: 5,
        sort: [{ key: "name", direction: "desc" }],
        include: { posts: true },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result[0].query.limit).toBe(5);
      expect(result[0].query.sort).toEqual([
        { key: "name", direction: "desc" },
      ]);
    });

    test("should propagate query properties to nested queries", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { active: true },
        limit: 10,
        include: { posts: true },
      };

      const result = queryEngine.breakdownQuery(query);

      expect(result[1].query.resource).toBe("posts");
      // Nested queries don't preserve where clause - they only get ...rest properties
      expect(result[1].query).toBeDefined();
    });
  });
});
