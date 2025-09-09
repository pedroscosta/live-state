import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { QueryBuilder, type QueryExecutor } from "../../src/client/query";
import type { LiveObjectAny } from "../../src/schema";

describe("QueryBuilder", () => {
  let mockExecutor: QueryExecutor;
  let mockCollection: LiveObjectAny;

  beforeEach(() => {
    mockExecutor = {
      get: vi.fn(),
      subscribe: vi.fn(),
    };

    mockCollection = {
      name: "users",
    } as LiveObjectAny;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create QueryBuilder instance", () => {
    const builder = QueryBuilder._init(mockCollection, mockExecutor);

    expect(builder).toBeInstanceOf(QueryBuilder);
    expect(typeof builder.get).toBe("function");
    expect(typeof builder.subscribe).toBe("function");
    expect(typeof builder.where).toBe("function");
    expect(typeof builder.include).toBe("function");
    expect(typeof builder.orderBy).toBe("function");
  });

  test("should execute get query with basic parameters", () => {
    const mockResult = [{ id: "1", name: "John" }];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const result = builder.get();

    expect(result).toBe(mockResult);
    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: {},
      include: {},
      limit: undefined,
      sort: undefined,
    });
  });

  test("should return correct JSON representation", () => {
    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const json = builder.where({ age: 30 }).include({ posts: true }).toJSON();

    expect(json).toEqual({
      resource: "users",
      where: { age: 30 },
      include: { posts: true },
      limit: undefined,
      sort: undefined,
    });
  });

  test("should return JSON with empty where and include by default", () => {
    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const json = builder.toJSON();

    expect(json).toEqual({
      resource: "users",
      where: {},
      include: {},
      limit: undefined,
      sort: undefined,
    });
  });

  test("should create new QueryBuilder instances for chaining", () => {
    const builder1 = QueryBuilder._init(mockCollection, mockExecutor);
    const builder2 = builder1.where({ age: 30 });
    const builder3 = builder2.include({ posts: true });

    // Each method should return a new instance
    expect(builder1).not.toBe(builder2);
    expect(builder2).not.toBe(builder3);
    expect(builder1).not.toBe(builder3);

    // Original builder should remain unchanged
    expect(builder1.toJSON()).toEqual({
      resource: "users",
      where: {},
      include: {},
      limit: undefined,
      sort: undefined,
    });

    // Final builder should have all modifications
    expect(builder3.toJSON()).toEqual({
      resource: "users",
      where: { age: 30 },
      include: { posts: true },
      limit: undefined,
      sort: undefined,
    });
  });

  test("should preserve bound methods", () => {
    const builder = QueryBuilder._init(mockCollection, mockExecutor);

    // Extract methods
    const { get, subscribe } = builder;

    // Methods should work when called independently
    expect(() => get()).not.toThrow();
    expect(() => subscribe(vi.fn())).not.toThrow();
  });

  test("should handle complex where conditions", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const complexWhere = {
      age: 30,
      name: "John",
      active: true,
      role: "admin",
      createdAt: "2023-01-01",
    };

    builder.where(complexWhere).get();

    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: complexWhere,
      include: {},
      limit: undefined,
      sort: undefined,
    });
  });

  test("should handle complex include conditions", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const complexInclude = {
      posts: true,
      comments: true,
      profile: {
        avatar: true,
        settings: true,
      },
    };

    builder.include(complexInclude).get();

    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: {},
      include: complexInclude,
      limit: undefined,
      sort: undefined,
    });
  });

  test("should handle subscription callback with data", () => {
    const mockData = [{ id: "1", name: "John" }];
    const mockCallback = vi.fn();

    // Mock subscribe to immediately call the callback
    mockExecutor.subscribe = vi.fn().mockImplementation((query, callback) => {
      callback(mockData);
      return vi.fn();
    });

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    builder.subscribe(mockCallback);

    expect(mockCallback).toHaveBeenCalledWith(mockData);
  });

  test("should handle empty results", () => {
    mockExecutor.get = vi.fn().mockReturnValue([]);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const result = builder.get();

    expect(result).toEqual([]);
    expect(mockExecutor.get).toHaveBeenCalledTimes(1);
  });

  test("should handle null/undefined where values", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    builder.where({ deletedAt: null, archivedAt: undefined }).get();

    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: { deletedAt: null, archivedAt: undefined },
      include: {},
      limit: undefined,
      sort: undefined,
    });
  });

  test("should work with different collection names", () => {
    const postsCollection = { name: "posts" } as LiveObjectAny;
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(postsCollection, mockExecutor);
    builder.get();

    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "posts",
      where: {},
      include: {},
      limit: undefined,
      sort: undefined,
    });
  });

  test("should execute get query with limit clause", () => {
    const mockResult = [
      { id: "1", name: "John" },
      { id: "2", name: "Jane" },
    ];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const result = builder.limit(10).get();

    expect(result).toBe(mockResult);
    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: {},
      include: {},
      limit: 10,
    });
  });

  test("should execute get query with where, include, and limit", () => {
    const mockResult = [{ id: "1", name: "John", age: 30, posts: [] }];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const result = builder
      .where({ active: true } as any)
      .include({ posts: true })
      .limit(5)
      .get();

    expect(result).toBe(mockResult);
    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: { active: true },
      include: { posts: true },
      limit: 5,
    });
  });

  test("should execute subscribe with limit clause", () => {
    const mockUnsubscribe = vi.fn();
    mockExecutor.subscribe = vi.fn().mockReturnValue(mockUnsubscribe);
    const mockCallback = vi.fn();

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const unsubscribe = builder.limit(3).subscribe(mockCallback);

    expect(unsubscribe).toBe(mockUnsubscribe);
    expect(mockExecutor.subscribe).toHaveBeenCalledWith(
      {
        resource: "users",
        where: {},
        include: {},
        limit: 3,
      },
      expect.any(Function)
    );
  });

  test("should chain limit with other methods", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    builder
      .where({ active: true } as any)
      .limit(2)
      .include({ posts: true })
      .get();

    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: { active: true },
      include: { posts: true },
      limit: 2,
    });
  });

  test("should return correct JSON representation with limit", () => {
    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const json = builder
      .where({ active: true } as any)
      .include({ posts: true })
      .limit(15)
      .toJSON();

    expect(json).toEqual({
      resource: "users",
      where: { active: true },
      include: { posts: true },
      limit: 15,
    });
  });

  test("should create new QueryBuilder instance when using limit", () => {
    const builder1 = QueryBuilder._init(mockCollection, mockExecutor);
    const builder2 = builder1.limit(10);

    // Should return a new instance
    expect(builder1).not.toBe(builder2);

    // Original builder should remain unchanged
    expect(builder1.toJSON()).toEqual({
      resource: "users",
      where: {},
      include: {},
      limit: undefined,
      sort: undefined,
    });

    // New builder should have the limit
    expect(builder2.toJSON()).toEqual({
      resource: "users",
      where: {},
      include: {},
      limit: 10,
      sort: undefined,
    });
  });

  test("should handle zero limit", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const result = builder.limit(0).get();

    expect(result).toBe(mockResult);
    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: {},
      include: {},
      limit: 0,
    });
  });

  test("should override previous limit when chained", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    builder.limit(5).limit(10).get();

    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: {},
      include: {},
      limit: 10,
    });
  });

  describe("where method", () => {
    test("should execute get query with where clause", () => {
      const mockResult = [{ id: "1", name: "John", age: 30 }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.where({ age: 30 }).get();

      expect(result).toBe(mockResult);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { age: 30 },
        include: {},
        limit: undefined,
      });
    });

    test("should execute get query with include clause", () => {
      const mockResult = [{ id: "1", name: "John", posts: [] }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.include({ posts: true }).get();

      expect(result).toBe(mockResult);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: { posts: true },
        limit: undefined,
      });
    });

    test("should execute get query with both where and include", () => {
      const mockResult = [{ id: "1", name: "John", age: 30, posts: [] }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.where({ age: 30 }).include({ posts: true }).get();

      expect(result).toBe(mockResult);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { age: 30 },
        include: { posts: true },
        limit: undefined,
      });
    });

    test("should chain multiple where clauses", () => {
      const mockResult = [{ id: "1", name: "John", age: 30, active: true }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.where({ age: 30 }).where({ active: true }).get();

      expect(result).toBe(mockResult);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { age: 30, active: true },
        include: {},
        limit: undefined,
      });
    });
  });

  describe("include method", () => {
    test("should chain multiple include clauses", () => {
      const mockResult = [{ id: "1", name: "John", posts: [], comments: [] }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .include({ posts: true })
        .include({ comments: true })
        .get();

      expect(result).toBe(mockResult);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: { posts: true, comments: true },
        limit: undefined,
      });
    });

    test("should execute subscribe with callback", () => {
      const mockUnsubscribe = vi.fn();
      mockExecutor.subscribe = vi.fn().mockReturnValue(mockUnsubscribe);
      const mockCallback = vi.fn();

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const unsubscribe = builder.subscribe(mockCallback);

      expect(unsubscribe).toBe(mockUnsubscribe);
      expect(mockExecutor.subscribe).toHaveBeenCalledWith(
        {
          resource: "users",
          where: {},
          include: {},
          limit: undefined,
        },
        expect.any(Function)
      );
    });

    test("should execute subscribe with where and include", () => {
      const mockUnsubscribe = vi.fn();
      mockExecutor.subscribe = vi.fn().mockReturnValue(mockUnsubscribe);
      const mockCallback = vi.fn();

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const unsubscribe = builder
        .where({ active: true })
        .include({ posts: true })
        .subscribe(mockCallback);

      expect(unsubscribe).toBe(mockUnsubscribe);
      expect(mockExecutor.subscribe).toHaveBeenCalledWith(
        {
          resource: "users",
          where: { active: true },
          include: { posts: true },
          limit: undefined,
        },
        expect.any(Function)
      );
    });
  });

  describe("one method", () => {
    test("should query by ID and return single result", () => {
      const mockResult = [{ id: "123", name: "John" }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.one("123").get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "123" },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should return undefined when no result found", () => {
      mockExecutor.get = vi.fn().mockReturnValue([]);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.one("nonexistent").get();

      expect(result).toBeUndefined();
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "nonexistent" },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should work with include clause", () => {
      const mockResult = [{ id: "123", name: "John", posts: [] }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.include({ posts: true }).one("123").get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "123" },
        include: { posts: true },
        limit: 1,
        sort: undefined,
      });
    });

    test("should work with subscribe and return single result", () => {
      const mockData = [{ id: "123", name: "John" }];
      const mockCallback = vi.fn();

      mockExecutor.subscribe = vi.fn().mockImplementation((query, callback) => {
        callback(mockData);
        return vi.fn();
      });

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.one("123").subscribe(mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(mockData[0]);
      expect(mockExecutor.subscribe).toHaveBeenCalledWith(
        {
          resource: "users",
          where: { id: "123" },
          include: {},
          limit: 1,
        },
        expect.any(Function)
      );
    });

    test("should call subscribe callback with undefined when no result", () => {
      const mockCallback = vi.fn();

      mockExecutor.subscribe = vi.fn().mockImplementation((query, callback) => {
        callback([]);
        return vi.fn();
      });

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.one("nonexistent").subscribe(mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(undefined);
    });
  });

  describe("first method", () => {
    test("should return first result without where clause", () => {
      const mockResult = [
        { id: "1", name: "John" },
        { id: "2", name: "Jane" },
      ];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.first().get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should return first result with where clause", () => {
      const mockResult = [{ id: "1", name: "John", active: true }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.first({ active: true } as any).get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { active: true },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should return undefined when no results found", () => {
      mockExecutor.get = vi.fn().mockReturnValue([]);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.first({ nonexistent: true } as any).get();

      expect(result).toBeUndefined();
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { nonexistent: true },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should work with include clause", () => {
      const mockResult = [{ id: "1", name: "John", posts: [] }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .include({ posts: true })
        .first({ active: true } as any)
        .get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { active: true },
        include: { posts: true },
        limit: 1,
        sort: undefined,
      });
    });

    test("should work with subscribe and return single result", () => {
      const mockData = [{ id: "1", name: "John" }];
      const mockCallback = vi.fn();

      mockExecutor.subscribe = vi.fn().mockImplementation((query, callback) => {
        callback(mockData);
        return vi.fn();
      });

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.first({ active: true } as any).subscribe(mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(mockData[0]);
      expect(mockExecutor.subscribe).toHaveBeenCalledWith(
        {
          resource: "users",
          where: { active: true },
          include: {},
          limit: 1,
        },
        expect.any(Function)
      );
    });

    test("should call subscribe callback with undefined when no result", () => {
      const mockCallback = vi.fn();

      mockExecutor.subscribe = vi.fn().mockImplementation((query, callback) => {
        callback([]);
        return vi.fn();
      });

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.first({ nonexistent: true } as any).subscribe(mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(undefined);
    });

    test("should create new QueryBuilder instance", () => {
      const builder1 = QueryBuilder._init(mockCollection, mockExecutor);
      const builder2 = builder1.first({ active: true } as any);

      expect(builder1).not.toBe(builder2);

      // Original builder should remain unchanged
      expect(builder1.toJSON()).toEqual({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
      });
    });
  });

  describe("chaining with one and first", () => {
    test("should chain one with where clause (where should be overridden)", () => {
      const mockResult = [{ id: "123", name: "John", active: true }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .where({ active: true } as any)
        .one("123")
        .get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "123" },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should chain first with existing where clause (where should be overridden)", () => {
      const mockResult = [{ id: "1", name: "John", role: "admin" }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .where({ active: true } as any)
        .first({ role: "admin" } as any)
        .get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { role: "admin" },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should chain include with one", () => {
      const mockResult = [{ id: "123", name: "John", posts: [], comments: [] }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .include({ posts: true })
        .one("123")
        .include({ comments: true })
        .get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "123" },
        include: { posts: true, comments: true },
        limit: 1,
        sort: undefined,
      });
    });

    test("should chain include with first", () => {
      const mockResult = [{ id: "1", name: "John", posts: [], profile: {} }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .include({ posts: true })
        .first({ active: true })
        .include({ profile: true })
        .get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { active: true },
        include: { posts: true, profile: true },
        limit: 1,
        sort: undefined,
      });
    });

    test("should handle limit being overridden by one", () => {
      const mockResult = [{ id: "123", name: "John" }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.limit(10).one("123").get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "123" },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });

    test("should handle limit being overridden by first", () => {
      const mockResult = [{ id: "1", name: "John" }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.limit(5).first({ active: true }).get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { active: true },
        include: {},
        limit: 1,
        sort: undefined,
      });
    });
  });

  describe("sort method", () => {
    test("should execute get query with single sort clause", () => {
      const mockResult = [
        { id: "1", name: "Alice", age: 25 },
        { id: "2", name: "Bob", age: 30 },
      ];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.orderBy("name", "asc").get();

      expect(result).toBe(mockResult);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
        sort: [{ key: "name", direction: "asc" }],
      });
    });

    test("should execute get query with multiple sort clauses", () => {
      const mockResult = [];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.orderBy("age", "desc").orderBy("name", "asc").get();

      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
        sort: [
          { key: "age", direction: "desc" },
          { key: "name", direction: "asc" },
        ],
      });
    });

    test("should default to ascending direction when not specified", () => {
      const mockResult = [];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.orderBy("name").get();

      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
        sort: [{ key: "name", direction: "asc" }],
      });
    });

    test("should work with descending direction", () => {
      const mockResult = [];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.orderBy("createdAt", "desc").get();

      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
        sort: [{ key: "createdAt", direction: "desc" }],
      });
    });

    test("should chain sort with where and include", () => {
      const mockResult = [];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder
        .where({ active: true } as any)
        .include({ posts: true })
        .orderBy("name", "asc")
        .get();

      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { active: true },
        include: { posts: true },
        limit: undefined,
        sort: [{ key: "name", direction: "asc" }],
      });
    });

    test("should chain sort with limit", () => {
      const mockResult = [];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      builder.orderBy("age", "desc").limit(10).get();

      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: {},
        include: {},
        limit: 10,
        sort: [{ key: "age", direction: "desc" }],
      });
    });

    test("should work with subscribe", () => {
      const mockUnsubscribe = vi.fn();
      mockExecutor.subscribe = vi.fn().mockReturnValue(mockUnsubscribe);
      const mockCallback = vi.fn();

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const unsubscribe = builder
        .orderBy("name", "asc")
        .subscribe(mockCallback);

      expect(unsubscribe).toBe(mockUnsubscribe);
      expect(mockExecutor.subscribe).toHaveBeenCalledWith(
        {
          resource: "users",
          where: {},
          include: {},
          limit: undefined,
          sort: [{ key: "name", direction: "asc" }],
        },
        expect.any(Function)
      );
    });

    test("should work with one method", () => {
      const mockResult = [{ id: "123", name: "John" }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder.orderBy("name", "asc").one("123").get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { id: "123" },
        include: {},
        limit: 1,
        sort: [{ key: "name", direction: "asc" }],
      });
    });

    test("should work with first method", () => {
      const mockResult = [{ id: "1", name: "John", active: true }];
      mockExecutor.get = vi.fn().mockReturnValue(mockResult);

      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .orderBy("name", "asc")
        .first({ active: true } as any)
        .get();

      expect(result).toBe(mockResult[0]);
      expect(mockExecutor.get).toHaveBeenCalledWith({
        resource: "users",
        where: { active: true },
        include: {},
        limit: 1,
        sort: [{ key: "name", direction: "asc" }],
      });
    });

    test("should return correct JSON representation with sort", () => {
      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const json = builder
        .where({ active: true } as any)
        .include({ posts: true })
        .orderBy("name", "asc")
        .orderBy("age", "desc")
        .toJSON();

      expect(json).toEqual({
        resource: "users",
        where: { active: true },
        include: { posts: true },
        limit: undefined,
        sort: [
          { key: "name", direction: "asc" },
          { key: "age", direction: "desc" },
        ],
      });
    });

    test("should create new QueryBuilder instance when using sort", () => {
      const builder1 = QueryBuilder._init(mockCollection, mockExecutor);
      const builder2 = builder1.orderBy("name", "asc");

      // Should return a new instance
      expect(builder1).not.toBe(builder2);

      // Original builder should remain unchanged
      expect(builder1.toJSON()).toEqual({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
        sort: undefined,
      });

      // New builder should have the sort
      expect(builder2.toJSON()).toEqual({
        resource: "users",
        where: {},
        include: {},
        limit: undefined,
        sort: [{ key: "name", direction: "asc" }],
      });
    });

    test("should preserve existing sort when chaining", () => {
      const builder = QueryBuilder._init(mockCollection, mockExecutor);
      const result = builder
        .orderBy("name", "asc")
        .orderBy("age", "desc")
        .orderBy("createdAt", "asc");

      expect(result.toJSON().sort).toEqual([
        { key: "name", direction: "asc" },
        { key: "age", direction: "desc" },
        { key: "createdAt", direction: "asc" },
      ]);
    });
  });
});
