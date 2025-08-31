import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ObjectGraph } from "../../../src/client/websocket/obj-graph";
import { KVStorage } from "../../../src/client/websocket/storage";
import { OptimisticStore } from "../../../src/client/websocket/store";
import { DefaultMutationMessage } from "../../../src/core/schemas/web-socket";
import {
  Schema,
  createRelations,
  id,
  number,
  object,
  string,
} from "../../../src/schema";

// Mock dependencies
vi.mock("../../../src/client/websocket/storage");
vi.mock("../../../src/client/websocket/obj-graph");

describe("OptimisticStore", () => {
  let store: OptimisticStore;
  let mockSchema: Schema<any>;
  let mockKVStorage: any;
  let mockObjectGraph: any;
  let afterLoadMutations: vi.Mock;

  beforeEach(() => {
    // Create mock schema
    const user = object("users", {
      id: id(),
      name: string(),
      age: number(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: string(),
    });

    const userRelations = createRelations(user, ({ many }) => ({
      posts: many(post, "userId"),
    }));

    const postRelations = createRelations(post, ({ one }) => ({
      author: one(user, "userId"),
    }));

    mockSchema = {
      users: user.setRelations(userRelations.relations),
      posts: post.setRelations(postRelations.relations),
    };

    // Mock KVStorage
    mockKVStorage = {
      init: vi.fn().mockResolvedValue(undefined),
      getMeta: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      setMeta: vi.fn().mockResolvedValue(undefined),
    };

    // Mock ObjectGraph
    mockObjectGraph = {
      createNode: vi.fn(),
      getNode: vi.fn(),
      hasNode: vi.fn().mockReturnValue(false),
      subscribe: vi.fn().mockReturnValue(() => {}),
      createLink: vi.fn(),
      removeLink: vi.fn(),
      notifySubscribers: vi.fn(),
    };

    (KVStorage as any).mockImplementation(() => mockKVStorage);
    (ObjectGraph as any).mockImplementation(() => mockObjectGraph);

    afterLoadMutations = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create an OptimisticStore instance", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    expect(store).toBeInstanceOf(OptimisticStore);
    expect(store.schema).toBe(mockSchema);
  });

  test("should initialize storage and load mutations on construction", async () => {
    const mockMutationStack = {
      users: [
        {
          id: "mut1",
          type: "MUTATE",
          resource: "users",
          resourceId: "user1",
          payload: {},
        },
      ],
    };

    mockKVStorage.getMeta.mockResolvedValue(mockMutationStack);
    mockKVStorage.get.mockResolvedValue({ user1: { name: "John" } });

    store = new OptimisticStore(mockSchema, "test-storage", afterLoadMutations);

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockKVStorage.init).toHaveBeenCalledWith(mockSchema, "test-storage");
    expect(afterLoadMutations).toHaveBeenCalledWith(mockMutationStack);
  });

  test("should get all objects of a resource type", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mockData = {
      user1: {
        value: {
          id: { value: "user1", _meta: { timestamp: "2023-01-01" } },
          name: { value: "John", _meta: { timestamp: "2023-01-01" } },
          age: { value: 30, _meta: { timestamp: "2023-01-01" } },
        },
        _meta: { timestamp: "2023-01-01" },
      },
      user2: {
        value: {
          id: { value: "user2", _meta: { timestamp: "2023-01-01" } },
          name: { value: "Jane", _meta: { timestamp: "2023-01-01" } },
          age: { value: 25, _meta: { timestamp: "2023-01-01" } },
        },
        _meta: { timestamp: "2023-01-01" },
      },
    };

    store["optimisticRawObjPool"] = { users: mockData };

    const result = store.get("users");

    expect(result).toEqual({
      user1: { id: "user1", name: "John", age: 30 },
      user2: { id: "user2", name: "Jane", age: 25 },
    });
  });

  test("should return empty object when no data exists for resource type", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const result = store.get("nonexistent");

    expect(result).toEqual({});
  });

  test("should get one object by id", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mockNode = {
      id: "user1",
      type: "users",
      references: new Map(),
      referencedBy: new Map(),
      subscriptions: new Set(),
    };

    const mockData = {
      value: {
        id: { value: "user1", _meta: { timestamp: "2023-01-01" } },
        name: { value: "John", _meta: { timestamp: "2023-01-01" } },
        age: { value: 30, _meta: { timestamp: "2023-01-01" } },
      },
      _meta: { timestamp: "2023-01-01" },
    };

    mockObjectGraph.getNode.mockReturnValue(mockNode);
    store["optimisticRawObjPool"] = { users: { user1: mockData } };

    const result = store.getOne("users", "user1");

    expect(result).toEqual({ id: "user1", name: "John", age: 30 });
  });

  test("should return undefined when node doesn't exist", () => {
    store = new OptimisticStore(mockSchema, "test-storage");
    mockObjectGraph.getNode.mockReturnValue(undefined);

    const result = store.getOne("users", "nonexistent");

    expect(result).toBeUndefined();
  });

  test("should return undefined when object doesn't exist in pool", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mockNode = {
      id: "user1",
      type: "users",
      references: new Map(),
      referencedBy: new Map(),
      subscriptions: new Set(),
    };

    mockObjectGraph.getNode.mockReturnValue(mockNode);
    store["optimisticRawObjPool"] = { users: {} };

    const result = store.getOne("users", "user1");

    expect(result).toBeUndefined();
  });

  test("should subscribe to resource type changes", () => {
    store = new OptimisticStore(mockSchema, "test-storage");
    const listener = vi.fn();

    const unsubscribe = store.subscribe(["users"], listener);

    expect(typeof unsubscribe).toBe("function");
    expect(store["resourceTypeSubscriptions"]["users"]).toContain(listener);

    unsubscribe();
    expect(store["resourceTypeSubscriptions"]["users"]).not.toContain(listener);
  });

  test("should subscribe to specific object changes", () => {
    store = new OptimisticStore(mockSchema, "test-storage");
    const listener = vi.fn();

    const mockNode = { id: "user1" };
    mockObjectGraph.getNode.mockReturnValue(mockNode);
    mockObjectGraph.subscribe.mockReturnValue(() => {});

    const unsubscribe = store.subscribe(["users", "user1"], listener);

    expect(mockObjectGraph.subscribe).toHaveBeenCalledWith("user1", listener);
  });

  test("should throw error when subscribing to non-existent node", () => {
    store = new OptimisticStore(mockSchema, "test-storage");
    mockObjectGraph.getNode.mockReturnValue(undefined);

    expect(() => {
      store.subscribe(["users", "nonexistent"], vi.fn());
    }).toThrow("Node not found");
  });

  test("should throw error for unsupported subscription path", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    expect(() => {
      store.subscribe(["users", "user1", "field"], vi.fn());
    }).toThrow("Not implemented");
  });

  test("should add optimistic mutation", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: {
        name: { value: "John", _meta: { timestamp: "2023-01-01" } },
      },
    };

    mockObjectGraph.hasNode.mockReturnValue(false);

    store.addMutation("users", mutation, true);

    expect(store.optimisticMutationStack["users"]).toContain(mutation);
    expect(mockKVStorage.setMeta).toHaveBeenCalledWith(
      "mutationStack",
      store.optimisticMutationStack
    );
    expect(mockObjectGraph.createNode).toHaveBeenCalledWith(
      "user1",
      "users",
      Object.values(mockSchema.users.relations).map((r) => r.entity.name)
    );
  });

  test("should add server mutation and remove optimistic version", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    // Add optimistic mutation first
    const optimisticMutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: {
        name: { value: "John", _meta: { timestamp: "2023-01-01" } },
      },
    };

    store.optimisticMutationStack["users"] = [optimisticMutation];

    // Add server mutation with same id
    const serverMutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: {
        name: { value: "John Doe", _meta: { timestamp: "2023-01-02" } },
      },
    };

    mockObjectGraph.hasNode.mockReturnValue(false);

    // Mock schema mergeMutation
    const mockMergeResult = {
      value: {
        name: { value: "John Doe", _meta: { timestamp: "2023-01-02" } },
      },
    };
    mockSchema.users.mergeMutation = vi
      .fn()
      .mockReturnValue([mockMergeResult, mockMergeResult]);

    store.addMutation("users", serverMutation, false);

    expect(store.optimisticMutationStack["users"]).not.toContain(
      optimisticMutation
    );
    expect(mockKVStorage.set).toHaveBeenCalled();
  });

  test("should throw error when schema not found", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "nonexistent",
      resourceId: "item1",
      payload: {},
    };

    expect(() => {
      store.addMutation("nonexistent", mutation);
    }).toThrow("Schema not found");
  });

  test("should handle relations when adding mutation", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "posts",
      resourceId: "post1",
      payload: {
        title: { value: "Test Post", _meta: { timestamp: "2023-01-01" } },
        userId: { value: "user1", _meta: { timestamp: "2023-01-01" } },
      },
    };

    mockObjectGraph.hasNode.mockReturnValue(false);

    // Mock relation mergeMutation
    const mockRelationMergeResult = [
      { value: "user1", _meta: { timestamp: "2023-01-01" } },
      { value: "user1", _meta: { timestamp: "2023-01-01" } },
    ];
    mockSchema.posts.relations.author.mergeMutation = vi
      .fn()
      .mockReturnValue(mockRelationMergeResult);

    store.addMutation("posts", mutation, true);

    expect(mockObjectGraph.createNode).toHaveBeenCalledWith(
      "post1",
      "posts",
      []
    );
    expect(mockObjectGraph.createNode).toHaveBeenCalledWith("user1", "users", [
      "posts",
    ]);
    expect(mockObjectGraph.createLink).toHaveBeenCalledWith(
      "post1",
      "user1",
      "posts"
    );
  });

  test("should remove existing link when relation changes", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const mutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "posts",
      resourceId: "post1",
      payload: {
        userId: { value: "user2", _meta: { timestamp: "2023-01-01" } },
      },
    };

    // Mock existing data with previous relation
    const prevValue = {
      value: {
        userId: { value: "user1", _meta: { timestamp: "2022-01-01" } },
      },
      _meta: { timestamp: "2022-01-01" },
    };

    store["optimisticRawObjPool"] = {
      posts: { post1: prevValue },
    };

    mockObjectGraph.hasNode.mockReturnValue(true);

    // Mock relation mergeMutation
    const mockRelationMergeResult = [
      { value: "user2", _meta: { timestamp: "2023-01-01" } },
      { value: "user2", _meta: { timestamp: "2023-01-01" } },
    ];
    mockSchema.posts.relations.author.mergeMutation = vi
      .fn()
      .mockReturnValue(mockRelationMergeResult);

    store.addMutation("posts", mutation, true);

    expect(mockObjectGraph.removeLink).toHaveBeenCalledWith("post1", "userId");
    expect(mockObjectGraph.createLink).toHaveBeenCalledWith(
      "post1",
      "user2",
      "posts"
    );
  });

  test("should notify subscribers after adding mutation", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const listener = vi.fn();
    store["resourceTypeSubscriptions"]["users"] = new Set([listener]);

    const mutation: DefaultMutationMessage = {
      id: "mut1",
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: {
        name: { value: "John", _meta: { timestamp: "2023-01-01" } },
      },
    };

    mockObjectGraph.hasNode.mockReturnValue(false);

    store.addMutation("users", mutation, true);

    expect(listener).toHaveBeenCalled();
    expect(mockObjectGraph.notifySubscribers).toHaveBeenCalledWith("user1");
  });

  test("should load consolidated state", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const data = {
      user1: { name: { value: "John", _meta: { timestamp: "2023-01-01" } } },
      user2: { name: { value: "Jane", _meta: { timestamp: "2023-01-01" } } },
    };

    const addMutationSpy = vi.spyOn(store, "addMutation");

    store.loadConsolidatedState("users", data);

    expect(addMutationSpy).toHaveBeenCalledTimes(2);
    expect(addMutationSpy).toHaveBeenCalledWith("users", {
      id: "user1",
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: data.user1,
    });
    expect(addMutationSpy).toHaveBeenCalledWith("users", {
      id: "user2",
      type: "MUTATE",
      resource: "users",
      resourceId: "user2",
      payload: data.user2,
    });
  });

  test("should handle getOne with relations", () => {
    store = new OptimisticStore(mockSchema, "test-storage");

    const userNode = {
      id: "user1",
      type: "users",
      references: new Map(),
      referencedBy: new Map([["posts", new Set(["post1", "post2"])]]),
      subscriptions: new Set(),
    };

    const postNode1 = {
      id: "post1",
      type: "posts",
      references: new Map([["posts", "user1"]]),
      referencedBy: new Map(),
      subscriptions: new Set(),
    };

    const postNode2 = {
      id: "post2",
      type: "posts",
      references: new Map([["posts", "user1"]]),
      referencedBy: new Map(),
      subscriptions: new Set(),
    };

    mockObjectGraph.getNode
      .mockReturnValueOnce(userNode)
      .mockReturnValueOnce(postNode1)
      .mockReturnValueOnce(postNode2);

    const userData = {
      value: {
        id: { value: "user1", _meta: { timestamp: "2023-01-01" } },
        name: { value: "John", _meta: { timestamp: "2023-01-01" } },
      },
      _meta: { timestamp: "2023-01-01" },
    };

    const postData1 = {
      value: {
        id: { value: "post1", _meta: { timestamp: "2023-01-01" } },
        title: { value: "Post 1", _meta: { timestamp: "2023-01-01" } },
      },
      _meta: { timestamp: "2023-01-01" },
    };

    const postData2 = {
      value: {
        id: { value: "post2", _meta: { timestamp: "2023-01-01" } },
        title: { value: "Post 2", _meta: { timestamp: "2023-01-01" } },
      },
      _meta: { timestamp: "2023-01-01" },
    };

    store["optimisticRawObjPool"] = {
      users: { user1: userData },
      posts: { post1: postData1, post2: postData2 },
    };

    const result = store.getOne("users", "user1");

    expect(result).toEqual({
      id: "user1",
      name: "John",
      posts: [
        { id: "post1", title: "Post 1" },
        { id: "post2", title: "Post 2" },
      ],
    });
  });

  test("should handle empty mutation stack during initialization", async () => {
    mockKVStorage.getMeta.mockResolvedValue({});

    store = new OptimisticStore(mockSchema, "test-storage", afterLoadMutations);

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(afterLoadMutations).not.toHaveBeenCalled();
  });

  test("should handle empty data during initialization", async () => {
    mockKVStorage.get.mockResolvedValue({});

    store = new OptimisticStore(mockSchema, "test-storage");

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should not call addMutation for empty data
    const addMutationSpy = vi.spyOn(store, "addMutation");
    expect(addMutationSpy).not.toHaveBeenCalled();
  });
});
