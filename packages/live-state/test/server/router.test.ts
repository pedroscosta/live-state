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
    const mockSchema = { users: {} as unknown } as Schema<any>;
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
      rawInsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      rawUpdate: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      transaction: vi.fn().mockImplementation(async (fn) => {
        return await fn({
          trx: mockStorage,
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined),
        });
      }),
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
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    const mockNewData = { value: { name: { value: "John" } } };

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

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
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {});
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
      procedure: "INSERT",
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
      procedure: "INSERT",
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
      procedure: "INSERT",
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

    const route = factory.collectionRoute(mockShape);

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

    const route = factory.collectionRoute(mockShape);

    expect(route.middlewares.has(middleware1)).toBe(true);
    expect(route.middlewares.has(middleware2)).toBe(true);
  });

  test("should work with routeFactory helper", () => {
    const factory = routeFactory();

    expect(factory).toBeInstanceOf(RouteFactory);
  });

  test("should create route with authorization", () => {
    const factory = RouteFactory.create();
    const mockShape = { name: "users" } as LiveObjectAny;
    const mockAuth = {
      read: vi.fn().mockReturnValue({ userId: "123" }),
    };

    const route = factory.collectionRoute(mockShape, mockAuth);

    expect(route).toBeInstanceOf(Route);
    expect(route.resourceName).toBe("users");
    expect(route.authorization).toBe(mockAuth);
  });
});

describe("Route Authorization", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;
  let mockResource: LiveObjectAny;

  beforeEach(() => {
    mockStorage = {
      rawFind: vi.fn().mockResolvedValue({}),
      rawFindById: vi.fn().mockResolvedValue(undefined),
      rawInsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      rawUpdate: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      transaction: vi.fn().mockImplementation(async (fn) => {
        return await fn({
          trx: mockStorage,
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined),
        });
      }),
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

  test("should apply authorization to QUERY requests", async () => {
    const authHandler = vi.fn().mockReturnValue({ userId: "123" });
    const route = new Route("users", undefined, { read: authHandler });

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(authHandler).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawFind).toHaveBeenCalledWith(
      "users",
      { userId: "123" },
      undefined
    );
  });

  test("should merge authorization with existing where clause", async () => {
    const authHandler = vi.fn().mockReturnValue({ userId: "123" });
    const route = new Route("users", undefined, { read: authHandler });

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
      where: { active: true },
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(mockStorage.rawFind).toHaveBeenCalledWith(
      "users",
      { $and: [{ active: true }, { userId: "123" }] },
      undefined
    );
  });

  test("should handle QUERY without authorization", async () => {
    const route = new Route("users");

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
      where: { active: true },
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
      { active: true },
      undefined
    );
  });
});

describe("Route UPDATE Authorization", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;
  let mockResource: LiveObjectAny;

  beforeEach(() => {
    mockStorage = {
      rawFind: vi.fn().mockResolvedValue({}),
      rawFindById: vi.fn().mockResolvedValue(undefined),
      rawInsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      rawUpdate: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      transaction: vi.fn().mockImplementation(async (fn) => {
        return await fn({
          trx: mockStorage,
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined),
        });
      }),
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

  test("should pass pre-mutation authorization for UPDATE operations", async () => {
    const preMutationAuth = vi.fn().mockReturnValue({ userId: "123" });
    const route = new Route("users", undefined, {
      update: { preMutation: preMutationAuth },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    const mockExistingData = {
      value: { id: { value: "user1" }, userId: { value: "123" } },
    };
    const mockNewData = {
      value: { name: { value: "John" }, userId: { value: "123" } },
    };

    // Reset and mock mergeMutation to return data that matches the authorization check
    (mockResource.mergeMutation as Mock).mockReset();
    (mockResource.mergeMutation as Mock).mockReturnValue([
      { value: { userId: { value: "123" } } }, // This will be used for pre-mutation authorization
      { accepted: true },
    ]);

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(preMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {
      value: { userId: { value: "123" } },
    });
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });

  test("should fail pre-mutation authorization for UPDATE operations", async () => {
    const preMutationAuth = vi.fn().mockReturnValue({ userId: "456" }); // Different user
    const route = new Route("users", undefined, {
      update: { preMutation: preMutationAuth },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    const mockExistingData = {
      value: { id: { value: "user1" }, userId: { value: "123" } },
    };

    // Reset and mock mergeMutation to return data that will fail authorization
    (mockResource.mergeMutation as Mock).mockReset();
    (mockResource.mergeMutation as Mock).mockReturnValue([
      { value: { userId: { value: "123" } } }, // This will be checked against the auth requirement of userId: "456"
      { accepted: true },
    ]);

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Not authorized");

    expect(preMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawUpdate).not.toHaveBeenCalled();
  });

  test("should pass post-mutation authorization for UPDATE operations", async () => {
    const postMutationAuth = vi.fn().mockReturnValue({ userId: "123" });
    const route = new Route("users", undefined, {
      update: { postMutation: postMutationAuth },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    const mockNewData = {
      value: { name: { value: "John" }, userId: { value: "123" } },
    };

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(postMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {});
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });

  test("should fail post-mutation authorization for UPDATE operations", async () => {
    const postMutationAuth = vi.fn().mockReturnValue({ userId: "456" }); // Different user
    const route = new Route("users", undefined, {
      update: { postMutation: postMutationAuth },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    const mockNewData = {
      value: { name: { value: "John" }, userId: { value: "123" } },
    };

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Not authorized");

    expect(postMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {});
  });

  test("should work with both pre and post mutation authorization", async () => {
    const preMutationAuth = vi.fn().mockReturnValue({ userId: "123" });
    const postMutationAuth = vi.fn().mockReturnValue({ userId: "123" });
    const route = new Route("users", undefined, {
      update: {
        preMutation: preMutationAuth,
        postMutation: postMutationAuth,
      },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    const mockExistingData = {
      value: { id: { value: "user1" }, userId: { value: "123" } },
    };
    const mockNewData = {
      value: { name: { value: "John" }, userId: { value: "123" } },
    };

    // Reset and mock mergeMutation to return data that matches the authorization check
    (mockResource.mergeMutation as Mock).mockReset();
    (mockResource.mergeMutation as Mock).mockReturnValue([
      { value: { userId: { value: "123" } } }, // This will be used for pre-mutation authorization
      { accepted: true },
    ]);

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(preMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(postMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {
      value: { userId: { value: "123" } },
    });
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });

  test("should fail when pre-mutation passes but post-mutation fails", async () => {
    const preMutationAuth = vi.fn().mockReturnValue({ userId: "123" });
    const postMutationAuth = vi.fn().mockReturnValue({ userId: "456" }); // Different user
    const route = new Route("users", undefined, {
      update: {
        preMutation: preMutationAuth,
        postMutation: postMutationAuth,
      },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123" },
    };

    const mockExistingData = {
      value: { id: { value: "user1" }, userId: { value: "123" } },
    };
    const mockNewData = {
      value: { name: { value: "John" }, userId: { value: "123" } },
    };

    // Reset and mock mergeMutation to return data that matches the pre-mutation authorization
    (mockResource.mergeMutation as Mock).mockReset();
    (mockResource.mergeMutation as Mock).mockReturnValue([
      { value: { userId: { value: "123" } } }, // This will pass pre-mutation authorization
      { accepted: true },
    ]);

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Not authorized");

    expect(preMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(postMutationAuth).toHaveBeenCalledWith({ userId: "123" });
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {
      value: { userId: { value: "123" } },
    });
  });

  test("should handle UPDATE operations without authorization", async () => {
    const route = new Route("users");

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    const mockNewData = { value: { name: { value: "John" } } };

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(mockStorage.rawFindById).toHaveBeenCalledWith("users", "user1");
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {});
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });

  test("should handle complex authorization where clauses", async () => {
    const preMutationAuth = vi.fn().mockReturnValue({
      $and: [{ userId: "123" }, { role: "admin" }],
    });
    const route = new Route("users", undefined, {
      update: { preMutation: preMutationAuth },
    });

    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: { userId: "123", role: "admin" },
    };

    const mockExistingData = {
      value: {
        id: { value: "user1" },
        userId: { value: "123" },
        role: { value: "admin" },
      },
    };
    const mockNewData = {
      value: {
        name: { value: "John" },
        userId: { value: "123" },
        role: { value: "admin" },
      },
    };

    // Reset and mock mergeMutation to return data that matches the complex authorization check
    (mockResource.mergeMutation as Mock).mockReset();
    (mockResource.mergeMutation as Mock).mockReturnValue([
      { value: { userId: { value: "123" }, role: { value: "admin" } } }, // This will match the $and clause
      { accepted: true },
    ]);

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(preMutationAuth).toHaveBeenCalledWith({
      userId: "123",
      role: "admin",
    });
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {
      value: { userId: { value: "123" }, role: { value: "admin" } },
    });
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });
});

describe("Route INSERT/UPDATE Edge Cases", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;
  let mockResource: LiveObjectAny;

  beforeEach(() => {
    mockStorage = {
      rawFind: vi.fn().mockResolvedValue({}),
      rawFindById: vi.fn().mockResolvedValue(undefined),
      rawInsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      rawUpdate: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      transaction: vi.fn().mockImplementation(async (fn) => {
        return await fn({
          trx: mockStorage,
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined),
        });
      }),
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

  test("should throw error when INSERT on existing resource", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "INSERT",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Resource already exists");
  });

  test("should throw error when UPDATE on non-existing resource", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    (mockStorage.rawFindById as Mock).mockResolvedValue(undefined);

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Resource not found");
  });

  test("should handle successful INSERT", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "INSERT",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockNewData = { value: { name: { value: "John" } } };
    (mockStorage.rawFindById as Mock).mockResolvedValue(undefined); // No existing resource
    (mockStorage.rawInsert as Mock).mockResolvedValue(mockNewData);

    const result = await route.handleRequest({
      req: mockRequest,
      db: mockStorage,
      schema: mockSchema,
    });

    expect(mockStorage.rawFindById).toHaveBeenCalledWith("users", "user1");
    expect(mockResource.mergeMutation).toHaveBeenCalledWith(
      "set",
      { name: "John" },
      undefined
    );
    expect(mockStorage.rawInsert).toHaveBeenCalledWith("users", "user1", {});
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });

  test("should handle successful UPDATE", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UPDATE",
      headers: {},
      cookies: {},
      query: {},
      context: {},
    };

    const mockExistingData = { value: { id: { value: "user1" } } };
    const mockNewData = { value: { name: { value: "John" } } };

    (mockStorage.rawFindById as Mock).mockResolvedValue(mockExistingData);
    (mockStorage.rawUpdate as Mock).mockResolvedValue(mockNewData);

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
    expect(mockStorage.rawUpdate).toHaveBeenCalledWith("users", "user1", {});
    expect(result).toEqual({
      data: mockNewData,
      acceptedValues: { accepted: true },
    });
  });
});

describe("Route Error Handling", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;
  let mockResource: LiveObjectAny;

  beforeEach(() => {
    mockStorage = {
      rawFind: vi.fn().mockResolvedValue({}),
      rawFindById: vi.fn().mockResolvedValue(undefined),
      rawInsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      rawUpdate: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      transaction: vi.fn().mockImplementation(async (fn) => {
        return await fn({
          trx: mockStorage,
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined),
        });
      }),
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

  test("should throw error when MUTATE request missing procedure", async () => {
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

    await expect(
      route.handleRequest({
        req: mockRequest,
        db: mockStorage,
        schema: mockSchema,
      })
    ).rejects.toThrow("Procedure is required for mutations");
  });

  test("should throw error for unknown procedure", async () => {
    const route = new Route("users");
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      resourceId: "user1",
      input: { name: "John" },
      procedure: "UNKNOWN_PROCEDURE",
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
    ).rejects.toThrow("Invalid request");
  });

  test("should handle middleware errors", async () => {
    const route = new Route("users");
    const errorMiddleware = vi.fn(() => {
      throw new Error("Middleware error");
    });

    route.use(errorMiddleware);

    const mockRequest: ParsedRequest = {
      type: "QUERY",
      resourceName: "users",
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
    ).rejects.toThrow("Middleware error");
  });

  test("should handle async middleware", async () => {
    const route = new Route("users");
    const executionOrder: string[] = [];

    const asyncMiddleware = vi.fn(async ({ next, req }) => {
      executionOrder.push("async-middleware-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = await next(req);
      executionOrder.push("async-middleware-end");
      return result;
    });

    route.use(asyncMiddleware);

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
      "async-middleware-start",
      "async-middleware-end",
    ]);
    expect(asyncMiddleware).toHaveBeenCalled();
  });

  test("should handle middleware that modifies request", async () => {
    const route = new Route("users");

    const modifyingMiddleware = vi.fn(({ next, req }) => {
      const modifiedReq = {
        ...req,
        context: { ...req.context, modified: true },
      };
      return next(modifiedReq);
    });

    route.use(modifyingMiddleware);

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

    expect(modifyingMiddleware).toHaveBeenCalled();
    expect(mockStorage.rawFind).toHaveBeenCalled();
  });
});

describe("Route Custom Mutations Advanced", () => {
  let mockStorage: Storage;
  let mockSchema: Schema<any>;
  let mockResource: LiveObjectAny;

  beforeEach(() => {
    mockStorage = {
      rawFind: vi.fn().mockResolvedValue({}),
      rawFindById: vi.fn().mockResolvedValue(undefined),
      rawInsert: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      rawUpdate: vi.fn().mockResolvedValue({} as MaterializedLiveType<any>),
      transaction: vi.fn().mockImplementation(async (fn) => {
        return await fn({
          trx: mockStorage,
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined),
        });
      }),
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

  test("should handle custom mutation with no input validator", async () => {
    const customHandler = vi.fn().mockResolvedValue({ success: true });
    const customMutations = {
      noInputAction: {
        inputValidator: z.undefined(),
        handler: customHandler,
      },
    };

    const route = new Route("users", customMutations);
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      procedure: "noInputAction",
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
        input: undefined,
      }),
      db: mockStorage,
      schema: mockSchema,
    });
    expect(result).toEqual({ success: true });
  });

  test("should handle custom mutation that throws error", async () => {
    const customHandler = vi.fn().mockRejectedValue(new Error("Custom error"));
    const customMutations = {
      errorAction: {
        inputValidator: z.object({}),
        handler: customHandler,
      },
    };

    const route = new Route("users", customMutations);
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      procedure: "errorAction",
      input: {},
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
    ).rejects.toThrow("Custom error");
  });

  test("should handle custom mutation with complex validation", async () => {
    const customHandler = vi.fn().mockResolvedValue({ result: "processed" });
    const customMutations = {
      complexAction: {
        inputValidator: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().min(18),
        }),
        handler: customHandler,
      },
    };

    const route = new Route("users", customMutations);
    const validInput = {
      name: "John Doe",
      email: "john@example.com",
      age: 25,
    };
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      procedure: "complexAction",
      input: validInput,
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
        input: validInput,
      }),
      db: mockStorage,
      schema: mockSchema,
    });
    expect(result).toEqual({ result: "processed" });
  });

  test("should reject invalid complex validation", async () => {
    const customHandler = vi.fn();
    const customMutations = {
      complexAction: {
        inputValidator: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().min(18),
        }),
        handler: customHandler,
      },
    };

    const route = new Route("users", customMutations);
    const invalidInput = {
      name: "Jo", // Too short
      email: "invalid-email", // Invalid email
      age: 16, // Too young
    };
    const mockRequest: ParsedRequest = {
      type: "MUTATE",
      resourceName: "users",
      procedure: "complexAction",
      input: invalidInput,
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

    expect(customHandler).not.toHaveBeenCalled();
  });

  test("should handle withMutations with multiple mutations", () => {
    const route = new Route("users");

    const newRoute = route.withMutations(({ mutation }) => ({
      action1: mutation(z.object({ data: z.string() })).handler(async () => ({
        success: true,
      })),
      action2: mutation(z.object({ value: z.number() })).handler(async () => ({
        count: 1,
      })),
      action3: mutation().handler(async () => ({ empty: true })),
    }));

    expect(newRoute.customMutations.action1).toBeDefined();
    expect(newRoute.customMutations.action2).toBeDefined();
    expect(newRoute.customMutations.action3).toBeDefined();
    expect(Object.keys(newRoute.customMutations)).toHaveLength(3);
  });
});
