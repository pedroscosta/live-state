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
    });
  });

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
    const result = builder
      .where({ age: 30 })
      .include({ posts: true })
      .get();

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
    const result = builder
      .where({ age: 30 })
      .where({ active: true })
      .get();

    expect(result).toBe(mockResult);
    expect(mockExecutor.get).toHaveBeenCalledWith({
      resource: "users",
      where: { age: 30, active: true },
      include: {},
      limit: undefined,
    });
  });

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
      mockCallback
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
      mockCallback
    );
  });

  test("should return correct JSON representation", () => {
    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    const json = builder
      .where({ age: 30 })
      .include({ posts: true })
      .toJSON();

    expect(json).toEqual({
      resource: "users",
      where: { age: 30 },
      include: { posts: true },
      limit: undefined,
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
    });

    // Final builder should have all modifications
    expect(builder3.toJSON()).toEqual({
      resource: "users",
      where: { age: 30 },
      include: { posts: true },
      limit: undefined,
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
    });
  });

  test("should execute get query with limit clause", () => {
    const mockResult = [{ id: "1", name: "John" }, { id: "2", name: "Jane" }];
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
      .where({ active: true })
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
      mockCallback
    );
  });

  test("should chain limit with other methods", () => {
    const mockResult = [];
    mockExecutor.get = vi.fn().mockReturnValue(mockResult);

    const builder = QueryBuilder._init(mockCollection, mockExecutor);
    builder
      .where({ active: true })
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
      .where({ active: true })
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
    });

    // New builder should have the limit
    expect(builder2.toJSON()).toEqual({
      resource: "users",
      where: {},
      include: {},
      limit: 10,
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
});
