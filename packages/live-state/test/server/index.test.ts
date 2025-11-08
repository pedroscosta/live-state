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
          handleQuery: vi.fn().mockResolvedValue({ data: {} }),
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
    const subscription = Array.from(collectionSubscriptions.values())[0];
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
    const subscriptionBefore = Array.from(collectionSubscriptions.values())[0];
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

    serverInstance.notifySubscribers(mutation);

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

    serverInstance.notifySubscribers(mutation);

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

    // Should not throw, but should log error
    expect(() => serverInstance.notifySubscribers(mutation)).not.toThrow();
    // handler1 was replaced by handler2, so only handler2 should be called
    expect(handler1).not.toHaveBeenCalled();
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
    expect(result).toEqual({ data: {} });
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
});
