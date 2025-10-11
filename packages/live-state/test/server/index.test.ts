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
import { Middleware, ParsedRequest, Server, server } from "../../src/server";
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
          handleRequest: vi
            .fn()
            .mockResolvedValue({ data: {}, acceptedValues: null }),
        },
      },
    } as unknown as AnyRouter;

    mockStorage = {
      updateSchema: vi.fn().mockResolvedValue(undefined),
    } as unknown as Storage;

    mockSchema = {
      users: { name: "users" },
    } as Schema<any>;
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
    expect(mockStorage.updateSchema).toHaveBeenCalledWith(mockSchema);
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

  test("should subscribe to mutations", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const unsubscribe = serverInstance.subscribeToMutations(handler);

    expect(typeof unsubscribe).toBe("function");
    expect((serverInstance as any).mutationSubscriptions.has(handler)).toBe(
      true
    );
  });

  test("should unsubscribe from mutations", () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    const unsubscribe = serverInstance.subscribeToMutations(handler);

    unsubscribe();

    expect((serverInstance as any).mutationSubscriptions.has(handler)).toBe(
      false
    );
  });

  test("should handle request successfully", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const result = await serverInstance.handleRequest({ req: mockRequest });

    expect(mockRouter.routes.users.handleRequest).toHaveBeenCalledWith({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });
    expect(result).toEqual({ data: {}, acceptedValues: null });
  });

  test("should throw error for invalid resource", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resource: "nonexistent",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await expect(
      serverInstance.handleRequest({ req: mockRequest })
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

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

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

    serverInstance.subscribeToMutations(handler1);
    serverInstance.subscribeToMutations(handler2);

    // Mock route to return mutation result with acceptedValues
    (mockRouter.routes.users.handleRequest as Mock).mockResolvedValue({
      data: {},
      acceptedValues: { name: "John" },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      procedure: "INSERT",
      context: { messageId: "msg123" },
      headers: {},
      cookies: {},
      query: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

    expect(handler1).toHaveBeenCalledWith({
      id: "msg123",
      type: "MUTATE",
      resource: "users",
      payload: { name: "John" },
      resourceId: "user1",
      procedure: "INSERT",
    });
    expect(handler2).toHaveBeenCalledWith({
      id: "msg123",
      type: "MUTATE",
      resource: "users",
      payload: { name: "John" },
      resourceId: "user1",
      procedure: "INSERT",
    });
  });

  test("should not notify mutation subscribers on query", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    serverInstance.subscribeToMutations(handler);

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

    expect(handler).not.toHaveBeenCalled();
  });

  test("should not notify mutation subscribers when no acceptedValues", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    serverInstance.subscribeToMutations(handler);

    // Mock route to return mutation result without acceptedValues
    (mockRouter.routes.users.handleRequest as Mock).mockResolvedValue({
      data: {},
      acceptedValues: null,
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      context: { messageId: "msg123" },
      headers: {},
      cookies: {},
      query: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

    expect(handler).not.toHaveBeenCalled();
  });

  test("should not notify mutation subscribers when acceptedValues is empty", async () => {
    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
    });

    const handler = vi.fn();
    serverInstance.subscribeToMutations(handler);

    // Mock route to return mutation result with empty acceptedValues
    (mockRouter.routes.users.handleRequest as Mock).mockResolvedValue({
      data: {},
      acceptedValues: {},
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      context: { messageId: "msg123" },
      headers: {},
      cookies: {},
      query: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

    expect(handler).not.toHaveBeenCalled();
  });

  test("should handle middleware that modifies request", async () => {
    const modifyingMiddleware: Middleware = ({ next, req }) => {
      req.context.modified = true;
      return next(req);
    };

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [modifyingMiddleware],
    });

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

    expect(mockRouter.routes.users.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: { modified: true },
      }),
      db: mockStorage,
      schema: mockSchema,
    });
  });

  test("should handle async middleware", async () => {
    const asyncMiddleware: Middleware = async ({ next, req }) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      req.context.async = true;
      return next(req);
    };

    const serverInstance = Server.create({
      router: mockRouter,
      storage: mockStorage,
      schema: mockSchema,
      middlewares: [asyncMiddleware],
    });

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resource: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await serverInstance.handleRequest({ req: mockRequest });

    expect(mockRouter.routes.users.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: { async: true },
      }),
      db: mockStorage,
      schema: mockSchema,
    });
  });
});
