import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { z } from "zod";
import { MaterializedLiveType, Schema } from "../../src/schema";
import { MutationRequest, QueryProcedureRequest } from "../../src/server";
import {
  Route,
  RouteFactory,
  routeFactory,
  Router,
  router,
} from "../../src/server/router";
import { Storage } from "../../src/server/storage";

describe("Router", () => {
  test("should create router instance", () => {
    const schema = {} as Schema<any>;
    const routes = { users: {} as any };
    const routerInstance = Router.create({ schema, routes });

    expect(routerInstance).toBeInstanceOf(Router);
    expect(routerInstance.routes).toEqual(routes);
    expect(routerInstance.schema).toBe(schema);
  });

  test("should create router with router helper function", () => {
    const mockSchema = { users: {} as unknown } as Schema<any>;
    const routes = { users: {} as any };

    const routerInstance = router({ schema: mockSchema, routes });

    expect(routerInstance).toBeInstanceOf(Router);
    expect(routerInstance.routes).toEqual(routes);
    expect(routerInstance.schema).toBe(mockSchema);
  });
});

const createMockStorage = () => {
  const mockStorage = {
    get: vi.fn().mockResolvedValue([]),
    rawFindById: vi.fn().mockResolvedValue(undefined),
    rawInsert: vi.fn().mockResolvedValue({
      data: {} as MaterializedLiveType<any>,
      acceptedValues: {},
    }),
    rawUpdate: vi.fn().mockResolvedValue({
      data: {} as MaterializedLiveType<any>,
      acceptedValues: {},
    }),
    _setMutationTimestamp: vi.fn(),
    transaction: vi.fn().mockImplementation(async (fn) =>
      fn({
        trx: mockStorage,
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      }),
    ),
  } as unknown as Storage;
  (mockStorage._setMutationTimestamp as any).mockImplementation(
    () => mockStorage,
  );
  return mockStorage;
};

describe("Route", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    mockSchema = {} as Schema<any>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create procedure route with custom mutations", () => {
    const customMutations = {
      doSomething: {
        _type: "mutation" as const,
        inputValidator: z.object({ data: z.string() }),
        handler: vi.fn(),
      },
    };

    const route = new Route(customMutations);

    expect(route.customMutations).toEqual(customMutations);
    expect(route.customQueries).toEqual({});
  });

  test("should create procedure route with custom queries", () => {
    const customQueries = {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.object({ id: z.string() }),
        handler: vi.fn(),
      },
    };

    const route = new Route(undefined, customQueries);

    expect(route.customQueries).toEqual(customQueries);
    expect(route.customMutations).toEqual({});
  });

  test("should add middlewares", () => {
    const route = new Route();
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();

    const result = route.use(middleware1, middleware2);

    expect(result).toBe(route);
    expect(route.middlewares.has(middleware1)).toBe(true);
    expect(route.middlewares.has(middleware2)).toBe(true);
  });

  test("should handle custom mutation", async () => {
    const customHandler = vi.fn().mockResolvedValue({ success: true });
    const route = new Route({
      doSomething: {
        _type: "mutation" as const,
        inputValidator: z.object({ data: z.string() }),
        handler: customHandler,
      },
    });
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      procedure: "doSomething",
      input: { data: "test" },
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    const result = await route.handleMutation({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(customHandler).toHaveBeenCalledWith({
      req: expect.objectContaining({ input: { data: "test" } }),
      db: expect.any(Object),
    });
    expect(result).toEqual({ success: true });
  });

  test("should validate custom mutation input", async () => {
    const customHandler = vi.fn();
    const route = new Route({
      doSomething: {
        _type: "mutation" as const,
        inputValidator: z.object({ data: z.string() }),
        handler: customHandler,
      },
    });
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      procedure: "doSomething",
      input: { data: 123 },
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleMutation({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Validation failed");
    expect(customHandler).not.toHaveBeenCalled();
  });

  test("should throw error when MUTATE request missing procedure", async () => {
    const route = new Route();
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      input: { name: "John" },
      procedure: undefined as any,
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleMutation({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Procedure is required for mutations");
  });

  test("should throw on unknown procedure", async () => {
    const route = new Route();
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      procedure: "INSERT",
      input: {},
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleMutation({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Unknown procedure: INSERT");
  });

  test("should propagate errors thrown by a custom mutation handler", async () => {
    const customHandler = vi.fn().mockRejectedValue(new Error("Custom error"));
    const route = new Route({
      errorAction: {
        _type: "mutation" as const,
        inputValidator: z.object({}),
        handler: customHandler,
      },
    });
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      procedure: "errorAction",
      input: {},
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleMutation({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Custom error");
  });

  test("should handle custom mutation with complex validation", async () => {
    const customHandler = vi.fn().mockResolvedValue({ result: "processed" });
    const route = new Route({
      complexAction: {
        _type: "mutation" as const,
        inputValidator: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().min(18),
        }),
        handler: customHandler,
      },
    });
    const validInput = { name: "John Doe", email: "john@example.com", age: 25 };
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      procedure: "complexAction",
      input: validInput,
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    const result = await route.handleMutation({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(customHandler).toHaveBeenCalledWith({
      req: expect.objectContaining({ input: validInput }),
      db: expect.any(Object),
    });
    expect(result).toEqual({ result: "processed" });
  });

  test("should reject invalid complex validation", async () => {
    const customHandler = vi.fn();
    const route = new Route({
      complexAction: {
        _type: "mutation" as const,
        inputValidator: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().min(18),
        }),
        handler: customHandler,
      },
    });
    const mockRequest: MutationRequest = {
      type: "MUTATE",
      resource: "actions",
      procedure: "complexAction",
      input: { name: "Jo", email: "invalid-email", age: 16 },
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleMutation({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow();
    expect(customHandler).not.toHaveBeenCalled();
  });

  test("should handle custom query", async () => {
    const customHandler = vi.fn().mockResolvedValue([{ id: "1", name: "Test" }]);
    const route = new Route(undefined, {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.object({ filter: z.string() }),
        handler: customHandler,
      },
    });
    const mockRequest: QueryProcedureRequest = {
      type: "CUSTOM_QUERY",
      resource: "actions",
      procedure: "getSomething",
      input: { filter: "test" },
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    const result = await route.handleCustomQuery({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(customHandler).toHaveBeenCalledWith({
      req: expect.objectContaining({ input: { filter: "test" } }),
      db: expect.any(Object),
    });
    expect(result).toEqual([{ id: "1", name: "Test" }]);
  });

  test("should validate custom query input", async () => {
    const customHandler = vi.fn();
    const route = new Route(undefined, {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.object({ filter: z.string() }),
        handler: customHandler,
      },
    });
    const mockRequest: QueryProcedureRequest = {
      type: "CUSTOM_QUERY",
      resource: "actions",
      procedure: "getSomething",
      input: { filter: 123 },
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleCustomQuery({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Validation failed");
    expect(customHandler).not.toHaveBeenCalled();
  });

  test("should throw on unknown query procedure", async () => {
    const route = new Route();
    const mockRequest: QueryProcedureRequest = {
      type: "CUSTOM_QUERY",
      resource: "actions",
      procedure: "nonExistent",
      input: undefined,
      headers: {},
      cookies: {},
      queryParams: {},
      context: {},
    };

    await expect(
      route.handleCustomQuery({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Unknown query procedure: nonExistent");
  });

  test("should apply middlewares to mutations in order", async () => {
    const executionOrder: string[] = [];
    const middleware = vi.fn(({ req, next }) => {
      executionOrder.push("middleware-before");
      const result = next(req);
      executionOrder.push("middleware-after");
      return result;
    });

    const route = new Route({
      doSomething: {
        _type: "mutation" as const,
        inputValidator: z.undefined(),
        handler: vi.fn().mockImplementation(() => {
          executionOrder.push("handler");
          return { done: true };
        }),
      },
    });
    route.use(middleware);

    await route.handleMutation({
      req: {
        type: "MUTATE",
        resource: "actions",
        procedure: "doSomething",
        input: undefined,
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
      },
      db: mockStorage,
      schema: mockSchema,
    });

    expect(executionOrder).toEqual([
      "middleware-before",
      "handler",
      "middleware-after",
    ]);
  });

  test("should apply middlewares to queries in order", async () => {
    const executionOrder: string[] = [];
    const middleware = vi.fn(({ req, next }) => {
      executionOrder.push("middleware-before");
      const result = next(req);
      executionOrder.push("middleware-after");
      return result;
    });

    const route = new Route(undefined, {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.undefined(),
        handler: vi.fn().mockImplementation(() => {
          executionOrder.push("handler");
          return { data: [] };
        }),
      },
    });
    route.use(middleware);

    await route.handleCustomQuery({
      req: {
        type: "CUSTOM_QUERY",
        resource: "actions",
        procedure: "getSomething",
        input: undefined,
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
      },
      db: mockStorage,
      schema: mockSchema,
    });

    expect(executionOrder).toEqual([
      "middleware-before",
      "handler",
      "middleware-after",
    ]);
  });

  test("should propagate middleware errors", async () => {
    const route = new Route(undefined, {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.undefined(),
        handler: vi.fn(),
      },
    });
    route.use(
      vi.fn(() => {
        throw new Error("Middleware error");
      }),
    );

    await expect(
      route.handleCustomQuery({
        req: {
          type: "CUSTOM_QUERY",
          resource: "actions",
          procedure: "getSomething",
          input: undefined,
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        db: mockStorage,
        schema: mockSchema,
      }),
    ).rejects.toThrow("Middleware error");
  });

  test("should handle async middleware", async () => {
    const executionOrder: string[] = [];
    const asyncMiddleware = vi.fn(async ({ next, req }) => {
      executionOrder.push("async-middleware-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = await next(req);
      executionOrder.push("async-middleware-end");
      return result;
    });

    const route = new Route(undefined, {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.undefined(),
        handler: vi.fn().mockResolvedValue({ data: [] }),
      },
    });
    route.use(asyncMiddleware);

    await route.handleCustomQuery({
      req: {
        type: "CUSTOM_QUERY",
        resource: "actions",
        procedure: "getSomething",
        input: undefined,
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
      },
      db: mockStorage,
      schema: mockSchema,
    });

    expect(executionOrder).toEqual([
      "async-middleware-start",
      "async-middleware-end",
    ]);
    expect(asyncMiddleware).toHaveBeenCalled();
  });

  test("should handle middleware that modifies request context", async () => {
    const handler = vi.fn().mockResolvedValue({ data: [] });
    const modifyingMiddleware = vi.fn(({ next, req }) =>
      next({ ...req, context: { ...req.context, modified: true } }),
    );

    const route = new Route(undefined, {
      getSomething: {
        _type: "query" as const,
        inputValidator: z.undefined(),
        handler,
      },
    });
    route.use(modifyingMiddleware);

    await route.handleCustomQuery({
      req: {
        type: "CUSTOM_QUERY",
        resource: "actions",
        procedure: "getSomething",
        input: undefined,
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
      },
      db: mockStorage,
      schema: mockSchema,
    });

    expect(modifyingMiddleware).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: expect.objectContaining({ modified: true }),
      }),
      db: expect.any(Object),
    });
  });
});

describe("RouteFactory", () => {
  test("should create RouteFactory instance", () => {
    const factory = RouteFactory.create();

    expect(factory).toBeInstanceOf(RouteFactory);
  });

  test("should add middlewares to factory", () => {
    const factory = RouteFactory.create();
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();

    const newFactory = factory.use(middleware1, middleware2);

    expect(newFactory).toBeInstanceOf(RouteFactory);
    expect(newFactory).not.toBe(factory);
  });

  test("should work with routeFactory helper", () => {
    const factory = routeFactory();

    expect(factory).toBeInstanceOf(RouteFactory);
  });
});

describe("RouteFactory.withProcedures", () => {
  test("should create Route with mutations and queries", () => {
    const factory = RouteFactory.create();

    const route = factory.withProcedures(({ mutation, query }) => ({
      doSomething: mutation(z.object({ data: z.string() })).handler(
        async () => ({ success: true }),
      ),
      getSomething: query(z.object({ id: z.string() })).handler(async () => ({
        id: "1",
        name: "Test",
      })),
    }));

    expect(route).toBeInstanceOf(Route);
    expect(route.customMutations.doSomething).toBeDefined();
    expect(route.customMutations.doSomething._type).toBe("mutation");
    expect(route.customQueries.getSomething).toBeDefined();
    expect(route.customQueries.getSomething._type).toBe("query");
  });

  test("should apply factory middlewares to Route", () => {
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();
    const factory = RouteFactory.create().use(middleware1, middleware2);

    const route = factory.withProcedures(({ mutation }) => ({
      doSomething: mutation().handler(async () => ({})),
    }));

    expect(route.middlewares.has(middleware1)).toBe(true);
    expect(route.middlewares.has(middleware2)).toBe(true);
  });

  test("should work with routeFactory helper", () => {
    const route = routeFactory().withProcedures(({ mutation, query }) => ({
      doSomething: mutation().handler(async () => ({})),
      getSomething: query().handler(async () => ({})),
    }));

    expect(route).toBeInstanceOf(Route);
  });
});
