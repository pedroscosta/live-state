import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { QueryEngine } from "../../src/core/query-engine";
import { Schema } from "../../src/schema";
import {
  Middleware,
  MutationRequest,
  QueryRequest,
  Server,
  server,
} from "../../src/server";
import { AnyRouter } from "../../src/server/router";
import { Storage } from "../../src/server/storage";

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

    vi.spyOn(QueryEngine.prototype, "get").mockResolvedValue([]);
    vi.spyOn(QueryEngine.prototype, "subscribe").mockReturnValue(() => {});
    vi.spyOn(QueryEngine.prototype, "handleMutation").mockImplementation(
      () => {}
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
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

  test("should handle query request through QueryEngine", async () => {
    const expectedData = [{ id: "1" }];
    (QueryEngine.prototype.get as Mock).mockResolvedValue(expectedData);

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

    expect(QueryEngine.prototype.get).toHaveBeenCalledWith(
      { type: "QUERY", resource: "users" },
      {
        context: {
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
      }
    );
    expect(result.data).toEqual(expectedData);
    expect(result.unsubscribe).toBeUndefined();
  });

  test("should subscribe when subscription handler is provided", async () => {
    const unsubscribe = vi.fn();
    const subscriptionHandler = vi.fn();
    (QueryEngine.prototype.get as Mock).mockResolvedValue([{ id: "1" }]);
    (QueryEngine.prototype.subscribe as Mock).mockReturnValue(unsubscribe);

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

    const result = await serverInstance.handleQuery({
      req: mockRequest,
      subscription: subscriptionHandler,
    });

    expect(QueryEngine.prototype.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ type: "QUERY", resource: "users" }),
      expect.any(Function),
      expect.objectContaining({
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
      })
    );
    expect(result.unsubscribe).toBe(unsubscribe);

    const forwardedHandler = (QueryEngine.prototype.subscribe as Mock).mock
      .calls[0][1];
    const mutation = { id: "mutation-1" };
    forwardedHandler(mutation);
    expect(subscriptionHandler).toHaveBeenCalledWith(mutation);
  });

  test("should execute server middlewares in correct order for queries", async () => {
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

  test("should apply middleware modifications to query context", async () => {
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

    expect(QueryEngine.prototype.get).toHaveBeenCalledWith(
      { type: "QUERY", resource: "users" },
      {
        context: expect.objectContaining({
          context: { modified: true },
        }),
      }
    );
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

    expect(QueryEngine.prototype.get).toHaveBeenCalledWith(
      { type: "QUERY", resource: "users" },
      {
        context: expect.objectContaining({
          context: { async: true },
        }),
      }
    );
  });

  test("should forward mutation requests to the route", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
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

    const result = await serverInstance.handleMutation({ req: mockRequest });

    expect(mockRouter.routes.users.handleMutation).toHaveBeenCalledWith({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });
    expect(result).toEqual({ data: {} });
  });

  test("should throw error for invalid mutation resource", async () => {
    const serverInstance = Server.create({
      router: { routes: {} } as unknown as AnyRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "nonexistent",
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
      procedure: "INSERT",
      input: {},
    };

    await expect(
      serverInstance.handleMutation({ req: mockRequest })
    ).rejects.toThrow("Invalid resource");
  });

  test("should apply middlewares to mutation requests", async () => {
    const mutationMiddleware: Middleware = ({ next, req }) => {
      req.context.traceId = "trace-1";
      return next(req as any);
    };

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [mutationMiddleware],
    });

    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      procedure: "INSERT",
      input: { name: "John" },
      context: {},
      headers: {},
      cookies: {},
      queryParams: {},
    };

    await serverInstance.handleMutation({ req: mockRequest });

    expect(mockRouter.routes.users.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: { traceId: "trace-1" },
      }),
      db: mockStorage,
      schema: mockSchema,
    });
  });

  test("should delegate notifySubscribers to QueryEngine", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

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

    serverInstance.notifySubscribers(mutation as any, entityData as any);

    expect(QueryEngine.prototype.handleMutation).toHaveBeenCalledWith(
      mutation,
      entityData
    );
  });
});
