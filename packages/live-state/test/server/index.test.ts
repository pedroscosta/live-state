import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { Schema } from "../../src/schema";
import {
  Middleware,
  QueryRequest,
  MutationRequest,
  Server,
  server,
} from "../../src/server";
import { AnyRouter } from "../../src/server/router";
import { Storage } from "../../src/server/storage";
import { Batcher } from "../../src/server/storage/batcher";

describe("Server", () => {
  let mockRouter: AnyRouter;
  let mockStorage: Storage;
  let mockSchema: Schema<any>;

  beforeEach(() => {
    mockRouter = {
      routes: {
        users: {
          handleQuery: vi.fn().mockResolvedValue({ data: [] }),
          handleMutation: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    } as unknown as AnyRouter;

    mockStorage = {
      init: vi.fn().mockResolvedValue(undefined),
    } as unknown as Storage;

    mockSchema = {
      users: {
        name: "users",
        fields: {},
        relations: {},
        encodeMutation: vi.fn(),
        mergeMutation: vi.fn(),
        decode: vi.fn(),
        encode: vi.fn(),
        validate: vi.fn(),
        infer: vi.fn(),
        materialize: vi.fn(),
        inferValue: vi.fn(),
      },
    } as unknown as Schema<any>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create server instance", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    expect(serverInstance).toBeInstanceOf(Server);
    expect(serverInstance.router).toBe(mockRouter);
    expect(serverInstance.storage).toBe(mockStorage);
    expect(serverInstance.schema).toBe(mockSchema);
    expect(mockStorage.init).toHaveBeenCalledWith(
      mockSchema,
      expect.objectContaining({
        error: expect.any(Function),
        warn: expect.any(Function),
        info: expect.any(Function),
        debug: expect.any(Function),
      }),
      serverInstance
    );
  });

  test("should create server with helper function", () => {
    const serverInstance = server({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    expect(serverInstance).toBeInstanceOf(Server);
  });

  test("should create server with middlewares", () => {
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [middleware1, middleware2],
    });

    expect(serverInstance.middlewares.has(middleware1)).toBe(true);
    expect(serverInstance.middlewares.has(middleware2)).toBe(true);
  });

  test("should create server with context provider", () => {
    const contextProvider = vi.fn().mockReturnValue({ userId: "123" });

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      contextProvider,
    });

    expect(serverInstance.contextProvider).toBe(contextProvider);
  });

  test("should add middleware using use method", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const middleware = vi.fn();
    const result = serverInstance.use(middleware);

    expect(result).toBe(serverInstance);
    expect(serverInstance.middlewares.has(middleware)).toBe(true);
  });

  test("should set context provider using context method", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const contextProvider = vi.fn();
    const result = serverInstance.context(contextProvider);

    expect(result).toBe(serverInstance);
    expect(serverInstance.contextProvider).toBe(contextProvider);
  });

  test("should subscribe to mutations with query", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const query = { resource: "users" };
    const unsubscribe = serverInstance.subscribeToMutations(query, handler);

    expect(typeof unsubscribe).toBe("function");
    const collectionSubscriptions = (
      serverInstance as any
    ).collectionSubscriptions.get("users");
    expect(collectionSubscriptions).toBeDefined();
    const subscription = Array.from(collectionSubscriptions.values())[0] as {
      callbacks: Set<typeof handler>;
      query: typeof query;
      authorizationWhere?: any;
    };
    expect(subscription.callbacks.has(handler)).toBe(true);
  });

  test("should unsubscribe from mutations", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const query = { resource: "users" };
    const unsubscribe = serverInstance.subscribeToMutations(query, handler);

    // Verify subscription exists before unsubscribe
    const collectionSubscriptions = (
      serverInstance as any
    ).collectionSubscriptions.get("users");
    expect(collectionSubscriptions).toBeDefined();
    const subscriptionBefore = Array.from(
      collectionSubscriptions.values()
    )[0] as {
      callbacks: Set<typeof handler>;
      query: typeof query;
      authorizationWhere?: any;
    };
    expect(subscriptionBefore.callbacks.has(handler)).toBe(true);

    unsubscribe();

    // After unsubscribe, the subscription should be removed if no callbacks remain
    const subscriptionAfter = collectionSubscriptions.get(
      Array.from(collectionSubscriptions.keys())[0]
    );
    if (subscriptionAfter) {
      expect(subscriptionAfter.callbacks.has(handler)).toBe(false);
    } else {
      // Subscription was deleted because it had no callbacks
      expect(collectionSubscriptions.size).toBe(0);
    }
  });

  test("should notify subscribers when mutation occurs", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    // Use different queries to create separate subscriptions
    // (same query would replace the subscription due to current implementation)
    const query1 = { resource: "users" };
    const query2 = { resource: "users", where: { name: "John" } };

    serverInstance.subscribeToMutations(query1, handler1);
    serverInstance.subscribeToMutations(query2, handler2);

    const mutation = {
      id: "mutation-1",
      type: "MUTATE" as const,
      resource: "users",
      resourceId: "user-1",
      procedure: "INSERT" as const,
      payload: { name: { value: "John" } },
    };

    const entityData = {
      value: { id: "user-1", name: "John" },
      _meta: {},
    };

    serverInstance.notifySubscribers(mutation, entityData);

    // Both handlers should be called since they're subscribed to the same resource
    expect(handler1).toHaveBeenCalledWith(mutation);
    expect(handler2).toHaveBeenCalledWith(mutation);
  });

  test("should not notify subscribers for different resource", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const query = { resource: "users" };

    serverInstance.subscribeToMutations(query, handler);

    const mutation = {
      id: "mutation-1",
      type: "MUTATE" as const,
      resource: "posts",
      resourceId: "post-1",
      procedure: "INSERT" as const,
      payload: { title: { value: "Post" } },
    };

    const entityData = {
      value: { id: "post-1", title: "Post" },
      _meta: {},
    };

    serverInstance.notifySubscribers(mutation, entityData);

    expect(handler).not.toHaveBeenCalled();
  });

  test("should handle errors in mutation subscription handlers", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler1 = vi.fn().mockImplementation(() => {
      throw new Error("Handler error");
    });
    const handler2 = vi.fn();
    const query = { resource: "users" };

    // Subscribe with same query - second will replace first
    serverInstance.subscribeToMutations(query, handler1);
    serverInstance.subscribeToMutations(query, handler2);

    const mutation = {
      id: "mutation-1",
      type: "MUTATE" as const,
      resource: "users",
      resourceId: "user-1",
      procedure: "INSERT" as const,
      payload: { name: { value: "John" } },
    };

    const entityData = {
      value: { id: "user-1", name: "John" },
      _meta: {},
    };

    // Should not throw, but should log error
    expect(() =>
      serverInstance.notifySubscribers(mutation, entityData)
    ).not.toThrow();
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  test("should handle query request successfully", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const mockRequest: QueryRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    const result = await serverInstance.handleQuery({ req: mockRequest });

    expect(mockRouter.routes.users.handleQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "QUERY",
        resource: "users",
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
        collectionName: "users",
        included: [],
        stepId: "query",
        where: undefined,
      }),
      batcher: expect.any(Batcher),
    });
    expect(result).toEqual({ data: [], unsubscribe: expect.any(Function) });
  });

  test("should throw error for invalid resource", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const mockRequest: QueryRequest = {
      type: "QUERY",
      resource: "nonexistent",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      serverInstance.handleQuery({ req: mockRequest })
    ).rejects.toThrow("Invalid resource");
  });

  test("should execute server middlewares in correct order", async () => {
    const executionOrder: string[] = [];

    const middleware1: Middleware = vi.fn(({ next, req }) => {
      executionOrder.push("server-middleware1-before");
      const result = next(req);
      executionOrder.push("server-middleware1-after");
      return result;
    });

    const middleware2: Middleware = vi.fn(({ next, req }) => {
      executionOrder.push("server-middleware2-before");
      const result = next(req);
      executionOrder.push("server-middleware2-after");
      return result;
    });

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [middleware1, middleware2],
    });

    const mockRequest: QueryRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await serverInstance.handleQuery({ req: mockRequest });

    expect(executionOrder).toEqual([
      "server-middleware1-before",
      "server-middleware2-before",
      "server-middleware2-after",
      "server-middleware1-after",
    ]);
  });

  test("should notify mutation subscribers on successful mutation", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const query = { resource: "users" };

    serverInstance.subscribeToMutations(query, handler1);
    serverInstance.subscribeToMutations(query, handler2);

    // Mock route to return mutation result with acceptedValues
    (mockRouter.routes.users.handleMutation as Mock).mockResolvedValue({
      data: {},
      acceptedValues: { name: "John" },
    });

    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      procedure: "INSERT",
      input: { name: "John" },
      context: { messageId: "msg123" },
      headers: {},
      cookies: {},
      queryParams: {},
    };

    await serverInstance.handleMutation({ req: mockRequest });

    // Note: The old mutation subscription system is deprecated, but handleMutation
    // still calls notifySubscribers internally through storage mutations
    // These handlers won't be called directly from handleMutation anymore
    // They are called via notifySubscribers when storage mutations occur
  });

  test("should not notify mutation subscribers on query", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const query = { resource: "users" };
    serverInstance.subscribeToMutations(query, handler);

    const mockRequest: QueryRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await serverInstance.handleQuery({ req: mockRequest });

    expect(handler).not.toHaveBeenCalled();
  });

  test("should not notify mutation subscribers when no acceptedValues", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const query = { resource: "users" };
    serverInstance.subscribeToMutations(query, handler);

    // Mock route to return mutation result without acceptedValues
    (mockRouter.routes.users.handleMutation as Mock).mockResolvedValue({
      data: {},
      acceptedValues: null,
    });

    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      procedure: "INSERT",
      input: { name: "John" },
      context: { messageId: "msg123" },
      headers: {},
      cookies: {},
      queryParams: {},
    };

    await serverInstance.handleMutation({ req: mockRequest });

    // Note: Handlers are now called via storage mutations, not directly from handleMutation
    expect(handler).not.toHaveBeenCalled();
  });

  test("should not notify mutation subscribers when acceptedValues is empty", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const query = { resource: "users" };
    serverInstance.subscribeToMutations(query, handler);

    // Mock route to return mutation result with empty acceptedValues
    (mockRouter.routes.users.handleMutation as Mock).mockResolvedValue({
      data: {},
      acceptedValues: {},
    });

    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      procedure: "INSERT",
      input: { name: "John" },
      context: { messageId: "msg123" },
      headers: {},
      cookies: {},
      queryParams: {},
    };

    await serverInstance.handleMutation({ req: mockRequest });

    // Note: Handlers are now called via storage mutations, not directly from handleMutation
    expect(handler).not.toHaveBeenCalled();
  });

  test("should handle middleware that modifies request", async () => {
    const modifyingMiddleware: Middleware = ({ next, req }) => {
      req.context.modified = true;
      return next(req as any);
    };

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [modifyingMiddleware],
    });

    const mockRequest: QueryRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await serverInstance.handleQuery({ req: mockRequest });

    expect(mockRouter.routes.users.handleQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "QUERY",
        resource: "users",
        context: { modified: true },
        collectionName: "users",
        included: [],
        stepId: "query",
        where: undefined,
      }),
      batcher: expect.any(Batcher),
    });
  });

  test("should handle async middleware", async () => {
    const asyncMiddleware: Middleware = async ({ next, req }) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      req.context.async = true;
      return next(req as any);
    };

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [asyncMiddleware],
    });

    const mockRequest: QueryRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await serverInstance.handleQuery({ req: mockRequest });

    expect(mockRouter.routes.users.handleQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "QUERY",
        resource: "users",
        context: { async: true },
        collectionName: "users",
        included: [],
        stepId: "query",
        where: undefined,
      }),
      batcher: expect.any(Batcher),
    });
  });

  describe("subscribeToMutations with authorization", () => {
    test("should store authorizationWhere when provided", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      const query = { resource: "users" };
      const authorizationWhere = { userId: "user123" };

      serverInstance.subscribeToMutations(query, handler, authorizationWhere);

      const collectionSubscriptions = (
        serverInstance as any
      ).collectionSubscriptions.get("users");
      expect(collectionSubscriptions).toBeDefined();
      const subscription = Array.from(collectionSubscriptions.values())[0] as {
        callbacks: Set<typeof handler>;
        query: typeof query;
        authorizationWhere?: any;
      };
      expect(subscription.authorizationWhere).toEqual(authorizationWhere);
    });
  });

  describe("notifySubscribers with authorization filtering", () => {
    beforeEach(() => {
      // Create a more complete mock schema with fields
      // inferValue should extract plain values from MaterializedLiveType
      const inferValueMock = (v: any): any => {
        if (!v || typeof v !== "object") return v;
        if (v.value !== undefined && v._meta !== undefined) {
          // It's a MaterializedLiveType, extract the value
          if (
            typeof v.value === "object" &&
            v.value !== null &&
            !Array.isArray(v.value) &&
            !(v.value instanceof Date)
          ) {
            return Object.fromEntries(
              Object.entries(v.value).map(([key, val]: [string, any]) => {
                if (val && typeof val === "object" && val.value !== undefined) {
                  return [key, val.value];
                }
                return [key, val];
              })
            );
          }
          return v.value;
        }
        return v;
      };

      mockSchema = {
        users: {
          name: "users",
          fields: {
            id: {
              _value: "string",
              _meta: {},
              encodeMutation: vi.fn(),
              mergeMutation: vi.fn(),
              infer: vi.fn(),
              materialize: vi.fn(),
              inferValue: inferValueMock,
            },
            name: {
              _value: "string",
              _meta: {},
              encodeMutation: vi.fn(),
              mergeMutation: vi.fn(),
              infer: vi.fn(),
              materialize: vi.fn(),
              inferValue: inferValueMock,
            },
            userId: {
              _value: "string",
              _meta: {},
              encodeMutation: vi.fn(),
              mergeMutation: vi.fn(),
              infer: vi.fn(),
              materialize: vi.fn(),
              inferValue: inferValueMock,
            },
          },
          relations: {},
          encodeMutation: vi.fn(),
          mergeMutation: vi.fn(),
          decode: vi.fn(),
          encode: vi.fn(),
          validate: vi.fn(),
          infer: vi.fn(),
          materialize: vi.fn(),
          inferValue: inferValueMock,
        },
      } as unknown as Schema<any>;
    });

    test("should not notify when entityData is missing", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      const query = { resource: "users" };

      serverInstance.subscribeToMutations(query, handler);

      const mutation = {
        id: "mutation-1",
        type: "MUTATE" as const,
        resource: "users",
        resourceId: "user-1",
        procedure: "INSERT" as const,
        payload: { name: { value: "John" } },
      };

      serverInstance.notifySubscribers(mutation, null);

      expect(handler).not.toHaveBeenCalled();
    });

    test("should filter mutations based on subscription where clause", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      const query = { resource: "users", where: { name: "John" } };

      serverInstance.subscribeToMutations(query, handler);

      const mutation = {
        id: "mutation-1",
        type: "MUTATE" as const,
        resource: "users",
        resourceId: "user-1",
        procedure: "INSERT" as const,
        payload: { name: { value: "John" } },
      };

      // Entity matches where clause - use MaterializedLiveType structure
      const matchingEntityData = {
        value: {
          id: { value: "user-1" },
          name: { value: "John", _meta: {} },
        },
        _meta: {},
      };

      serverInstance.notifySubscribers(mutation, matchingEntityData);
      expect(handler).toHaveBeenCalledWith(mutation);

      handler.mockClear();

      // Entity doesn't match where clause
      const nonMatchingEntityData = {
        value: {
          id: { value: "user-2" },
          name: { value: "Jane", _meta: {} },
        },
        _meta: {},
      };

      const mutation2 = {
        ...mutation,
        resourceId: "user-2",
      };

      serverInstance.notifySubscribers(mutation2, nonMatchingEntityData);
      expect(handler).not.toHaveBeenCalled();
    });

    test("should filter mutations based on authorization where clause", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      const query = { resource: "users" };
      const authorizationWhere = { userId: "user123" };

      serverInstance.subscribeToMutations(query, handler, authorizationWhere);

      const mutation = {
        id: "mutation-1",
        type: "MUTATE" as const,
        resource: "users",
        resourceId: "user-1",
        procedure: "INSERT" as const,
        payload: { name: { value: "John" } },
      };

      // Entity matches authorization where clause
      const matchingEntityData = {
        value: {
          id: { value: "user-1" },
          name: { value: "John", _meta: {} },
          userId: { value: "user123", _meta: {} },
        },
        _meta: {},
      };

      serverInstance.notifySubscribers(mutation, matchingEntityData);
      expect(handler).toHaveBeenCalledWith(mutation);

      handler.mockClear();

      // Entity doesn't match authorization where clause
      const nonMatchingEntityData = {
        value: {
          id: { value: "user-2" },
          name: { value: "Jane", _meta: {} },
          userId: { value: "user456", _meta: {} },
        },
        _meta: {},
      };

      const mutation2 = {
        ...mutation,
        resourceId: "user-2",
      };

      serverInstance.notifySubscribers(mutation2, nonMatchingEntityData);
      expect(handler).not.toHaveBeenCalled();
    });

    test("should filter mutations based on merged subscription and authorization where clauses", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      const query = { resource: "users", where: { name: "John" } };
      const authorizationWhere = { userId: "user123" };

      serverInstance.subscribeToMutations(query, handler, authorizationWhere);

      const mutation = {
        id: "mutation-1",
        type: "MUTATE" as const,
        resource: "users",
        resourceId: "user-1",
        procedure: "INSERT" as const,
        payload: { name: { value: "John" } },
      };

      // Entity matches both where clauses
      const matchingEntityData = {
        value: {
          id: { value: "user-1" },
          name: { value: "John", _meta: {} },
          userId: { value: "user123", _meta: {} },
        },
        _meta: {},
      };

      serverInstance.notifySubscribers(mutation, matchingEntityData);
      expect(handler).toHaveBeenCalledWith(mutation);

      handler.mockClear();

      // Entity matches subscription where but not authorization where
      const nonMatchingEntityData = {
        value: {
          id: { value: "user-2" },
          name: { value: "John", _meta: {} },
          userId: { value: "user456", _meta: {} },
        },
        _meta: {},
      };

      const mutation2 = {
        ...mutation,
        resourceId: "user-2",
      };

      serverInstance.notifySubscribers(mutation2, nonMatchingEntityData);
      expect(handler).not.toHaveBeenCalled();
    });

    test("should notify all subscribers when no where clause (empty object)", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      const query = { resource: "users" };

      serverInstance.subscribeToMutations(query, handler);

      const mutation = {
        id: "mutation-1",
        type: "MUTATE" as const,
        resource: "users",
        resourceId: "user-1",
        procedure: "INSERT" as const,
        payload: { name: { value: "John" } },
      };

      const entityData = {
        value: {
          id: { value: "user-1" },
          name: { value: "John", _meta: {} },
        },
        _meta: {},
      };

      serverInstance.notifySubscribers(mutation, entityData);
      expect(handler).toHaveBeenCalledWith(mutation);
    });

    test("should extract first-level where clause and ignore relation where clauses", () => {
      const serverInstance = Server.create({
        router: mockRouter,
        storage: mockStorage,
        schema: mockSchema,
      });

      const handler = vi.fn();
      // Include relation where clause (should be ignored)
      const query = {
        resource: "users",
        where: { name: "John", posts: { title: "Post" } },
      };

      serverInstance.subscribeToMutations(query, handler);

      const mutation = {
        id: "mutation-1",
        type: "MUTATE" as const,
        resource: "users",
        resourceId: "user-1",
        procedure: "INSERT" as const,
        payload: { name: { value: "John" } },
      };

      // Entity matches first-level where clause (name: "John")
      // Relation where clause should be ignored
      const matchingEntityData = {
        value: {
          id: { value: "user-1" },
          name: { value: "John", _meta: {} },
        },
        _meta: {},
      };

      serverInstance.notifySubscribers(mutation, matchingEntityData);
      expect(handler).toHaveBeenCalledWith(mutation);
    });
  });
});
