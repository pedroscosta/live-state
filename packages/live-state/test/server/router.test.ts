import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { z } from "zod";
import { LiveObjectAny, MaterializedLiveType, Schema } from "../../src/schema";
import { ParsedRequest } from "../../src/server";
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
    const routes = { users: {} as any };
    const routerInstance = Router.create({ routes });

    expect(routerInstance).toBeInstanceOf(Router);
    expect(routerInstance.routes).toEqual(routes);
  });

  test("should create router with router helper function", () => {
    const mockSchema = { users: {} } as Schema<any>;
    const routes = { users: {} as any };

    const routerInstance = router({ schema: mockSchema, routes });

    expect(routerInstance).toBeInstanceOf(Router);
    expect(routerInstance.routes).toEqual(routes);
  });
});

describe("Route", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;
  let mockResource: LiveObjectAny;

  beforeEach(() => {
    mockStorage = {
      rawFind: vi.fn().mockResolvedValue({}),
      rawFindById: vi.fn().mockResolvedValue(undefined),
      rawUpsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
    } as unknown as Storage;

    mockResource = {
      name: "users",
      mergeMutation: vi.fn().mockReturnValue([{}, { accepted: true }]),
    } as unknown as LiveObjectAny;

    mockSchema = {
      users: mockResource,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create route instance", () => {
    const route = new Route("users");

    expect(route.resourceName).toBe("users");
    expect(route.middlewares).toBeInstanceOf(Set);
    expect(route.customMutations).toEqual({});
  });

  test("should create route with custom mutations", () => {
    const customMutations = {
      customAction: {
        inputValidator: z.object({}),
        handler: vi.fn(),
      },
    };

    const route = new Route("users", customMutations);

    expect(route.customMutations).toEqual(customMutations);
  });

  test("should add middlewares", () => {
    const route = new Route("users");
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();

    const result = route.use(middleware1, middleware2);

    expect(result).toBe(route);
    expect(route.middlewares.has(middleware1)).toBe(true);
    expect(route.middlewares.has(middleware2)).toBe(true);
  });

  test("should handle QUERY request", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockData = { user1: { value: { name: "John" } } };
    (mockStorage.rawFind as Mock).mockResolvedValue(mockData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(mockStorage.rawFind).toHaveBeenCalledWith(
      "users",
      undefined,
      undefined
    );
    expect(result).toEqual({
      data: mockData,
      acceptedValues: null,
    });
  });

  test("should handle QUERY request with where and include", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
      where: { name: "John" },
      include: { posts: true },
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(mockStorage.rawFind).toHaveBeenCalledWith(
      "users",
      { name: "John" },
      { posts: true }
    );
  });

  test("should handle MUTATE request (set)", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    const mockNewData = { value: { name: { value: "John" } } };

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpsert as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(mockStorage.rawFindById).toHaveBeenCalledWith("users", "user1");
    expect(mockResource.mergeMutation).toHaveBeenCalledWith(
      "set",
      { name: "John" },
      mockExistingData
    );
    expect(mockStorage.rawUpsert).toHaveBeenCalledWith("users", "user1", {});
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });

  test("should throw error when MUTATE request missing payload", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Payload is required");
  });

  test("should throw error when MUTATE request missing resourceId", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      input: { name: "John" },
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("ResourceId is required");
  });

  test("should throw error when mutation is rejected", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    (mockResource.mergeMutation as Mock).mockReturnValue([{}, null]);

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Mutation rejected");
  });

  test("should handle custom mutation", async () => {
    const customHandler = vi.fn().mockResolvedValue({ success: true });
    const customMutations = {
      customAction: {
        inputValidator: z.object({ data: z.string() }),
        handler: customHandler,
      },
    };

    const route = new Route("users", customMutations);
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      procedure: "customAction",
      input: { data: "test" },
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(customHandler).toHaveBeenCalledWith({
      req: expect.objectContaining({
        input: { data: "test" },
      }),
      db: mockStorage,
      schema: mockSchema,
    });
    expect(result).toEqual({ success: true });
  });

  test("should validate custom mutation input", async () => {
    const customHandler = vi.fn();
    const customMutations = {
      customAction: {
        inputValidator: z.object({ data: z.string() }),
        handler: customHandler,
      },
    };

    const route = new Route("users", customMutations);
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      procedure: "customAction",
      input: { data: 123 }, // Invalid input
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow();
  });

  test("should throw error for invalid request type", async () => {
    const route = new Route("users");
    const mockRequest = {
      type: "INVALID",
      resourceName: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    } as any;

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Invalid request");
  });

  test("should execute middlewares in correct order", async () => {
    const route = new Route("users");
    const executionOrder: string[] = [];

    const middleware1 = vi.fn(({ next, req }) => {
      executionOrder.push("middleware1-before");
      const result = next(req);
      executionOrder.push("middleware1-after");
      return result;
    });

    const middleware2 = vi.fn(({ next, req }) => {
      executionOrder.push("middleware2-before");
      const result = next(req);
      executionOrder.push("middleware2-after");
      return result;
    });

    route.use(middleware1, middleware2);

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(executionOrder).toEqual([
      "middleware1-before",
      "middleware2-before",
      "middleware2-after",
      "middleware1-after",
    ]);
  });

  test("should create route with mutations using withMutations", () => {
    const route = new Route("users");

    const newRoute = route.withMutations(({ mutation }) => ({
      customAction: mutation(z.object({ data: z.string() })).handler(
        async () => ({ success: true })
      ),
    }));

    expect(newRoute).toBeInstanceOf(Route);
    expect(newRoute.resourceName).toBe("users");
    expect(newRoute.customMutations.customAction).toBeDefined();
    expect(newRoute.customMutations.customAction.inputValidator).toBeDefined();
    expect(newRoute.customMutations.customAction.handler).toBeDefined();
  });
});

describe("RouteFactory", () => {
  test("should create RouteFactory instance", () => {
    const factory = RouteFactory.create();

    expect(factory).toBeInstanceOf(RouteFactory);
  });

  test("should create basic route", () => {
    const factory = RouteFactory.create();
    const mockShape = { name: "users" } as LiveObjectAny;

    const route = factory.createBasicRoute(mockShape);

    expect(route).toBeInstanceOf(Route);
    expect(route.resourceName).toBe("users");
  });

  test("should add middlewares to factory", () => {
    const factory = RouteFactory.create();
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();

    const newFactory = factory.use(middleware1, middleware2);

    expect(newFactory).toBeInstanceOf(RouteFactory);
    expect(newFactory).not.toBe(factory); // Should return new instance
  });

  test("should apply factory middlewares to created routes", () => {
    const middleware1 = vi.fn();
    const middleware2 = vi.fn();
    const factory = RouteFactory.create().use(middleware1, middleware2);
    const mockShape = { name: "users" } as LiveObjectAny;

    const route = factory.createBasicRoute(mockShape);

    expect(route.middlewares.has(middleware1)).toBe(true);
    expect(route.middlewares.has(middleware2)).toBe(true);
  });

  test("should work with routeFactory helper", () => {
    const factory = routeFactory();

    expect(factory).toBeInstanceOf(RouteFactory);
  });
});
