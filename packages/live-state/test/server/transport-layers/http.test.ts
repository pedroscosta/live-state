import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { Server } from "../../../src/server";
import { AnyRouter } from "../../../src/server/router";
import { httpTransportLayer } from "../../../src/server/transport-layers/http";

// Mock dependencies
vi.mock("cookie", () => ({
  default: {
    parse: vi.fn().mockReturnValue({ sessionId: "abc123" }),
  },
}));

vi.mock("qs", () => ({
  default: {
    parse: vi
      .fn()
      .mockReturnValue({ where: { name: "John" }, include: {}, limit: 10 }),
  },
}));

describe("httpTransportLayer", () => {
  let mockServer: Server<AnyRouter>;
  let httpHandler: (request: Request) => Promise<Response>;

  beforeEach(() => {
    mockServer = {
      contextProvider: vi.fn().mockResolvedValue({ userId: "user123" }),
      handleRequest: vi.fn().mockResolvedValue({
        data: { user1: { name: "John" } },
      }),
    } as unknown as Server<AnyRouter>;

    httpHandler = httpTransportLayer(mockServer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create HTTP transport layer handler", () => {
    expect(typeof httpHandler).toBe("function");
  });

  test("should handle GET request successfully", async () => {
    const request = new Request("http://localhost/users?where[name]=John", {
      method: "GET",
      headers: {
        "content-type": "application/json",
        cookie: "sessionId=abc123",
      },
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(200);
    expect(responseData).toEqual({ user1: { name: "John" } });
    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "QUERY",
        resourceName: "users",
        context: { userId: "user123" },
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
        cookies: { sessionId: "abc123" },
      }),
    });
  });

  test("should handle GET request with query parameters", async () => {
    const request = new Request(
      "http://localhost/users?page=1&limit=10&where[status]=active",
      {
        method: "GET",
      }
    );

    await httpHandler(request);

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "QUERY",
        resourceName: "users",
        query: expect.objectContaining({
          limit: 10,
          where: { name: "John" },
          include: {},
        }),
      }),
    });
  });

  test("should return 400 for invalid query parameters", async () => {
    const request = new Request("http://localhost/users?invalid=query", {
      method: "GET",
    });

    // Mock qs.parse to return invalid data that fails schema validation
    const qs = await import("qs");
    (qs.default.parse as Mock).mockReturnValueOnce({ where: "invalid" });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(400);
    expect(responseData).toEqual({
      message: "Invalid query",
      code: "INVALID_QUERY",
      details: expect.any(Object),
    });
  });

  test("should handle POST request with set mutation", async () => {
    const requestBody = {
      resourceId: "user1",
      payload: {
        name: {
          value: "John Updated",
          _meta: {
            timestamp: "2023-01-01T00:00:00.000Z",
          },
        },
      },
    };

    const request = new Request("http://localhost/users/set", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    (mockServer.handleRequest as Mock).mockResolvedValue({
      data: { name: "John Updated" },
      acceptedValues: { name: "John Updated" },
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(200);
    expect(responseData).toEqual({
      data: { name: "John Updated" },
      acceptedValues: { name: "John Updated" },
    });

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resourceName: "users",
        input: {
          name: {
            value: "John Updated",
            _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
          },
        },
        resourceId: "user1",
        procedure: undefined,
      }),
    });
  });

  test("should handle POST request with custom mutation", async () => {
    const requestBody = {
      payload: { action: "approve" },
    };

    const request = new Request("http://localhost/users/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    (mockServer.handleRequest as Mock).mockResolvedValue({
      success: true,
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(200);
    expect(responseData).toEqual({ success: true });
    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resourceName: "users",
        input: { action: "approve" },
        procedure: "approve",
      }),
    });
  });

  test("should return 400 for invalid set mutation payload", async () => {
    const requestBody = {
      // Missing required fields for set mutation
      payload: { name: "John" },
    };

    const request = new Request("http://localhost/users/set", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(400);
    expect(responseData).toEqual({
      message: "Invalid mutation",
      code: "INVALID_REQUEST",
      details: expect.any(Object),
    });
  });

  test("should return 400 when server returns invalid resource", async () => {
    const request = new Request("http://localhost/nonexistent", {
      method: "GET",
    });

    (mockServer.handleRequest as Mock).mockResolvedValue(null);

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(400);
    expect(responseData).toEqual({
      message: "Invalid resource",
      code: "INVALID_RESOURCE",
    });
  });

  test("should return 400 when server returns no data", async () => {
    const request = new Request("http://localhost/users", {
      method: "GET",
    });

    (mockServer.handleRequest as Mock).mockResolvedValue({ data: null });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(400);
    expect(responseData).toEqual({
      message: "Invalid resource",
      code: "INVALID_RESOURCE",
    });
  });

  test("should return 500 for POST request parsing errors", async () => {
    const request = new Request("http://localhost/users/set", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "invalid json",
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(500);
    expect(responseData).toEqual({
      message: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  test("should return 404 for unsupported HTTP methods", async () => {
    const request = new Request("http://localhost/users", {
      method: "PUT",
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(404);
    expect(responseData).toEqual({
      message: "Not found",
      code: "NOT_FOUND",
    });
  });

  test("should handle requests without context provider", async () => {
    mockServer.contextProvider = undefined;

    const request = new Request("http://localhost/users", {
      method: "GET",
    });

    await httpHandler(request);

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: {},
      }),
    });
  });

  test("should handle requests without cookies", async () => {
    const request = new Request("http://localhost/users", {
      method: "GET",
    });

    await httpHandler(request);

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        cookies: {},
      }),
    });
  });

  test("should handle POST request without body", async () => {
    const request = new Request("http://localhost/users/set", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(400);
    expect(responseData.code).toBe("INVALID_REQUEST");
  });

  test("should return 500 for unexpected errors", async () => {
    const request = new Request("http://localhost/users", {
      method: "GET",
    });

    (mockServer.handleRequest as Mock).mockRejectedValue(
      new Error("Unexpected error")
    );

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(500);
    expect(responseData).toEqual({
      message: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  test("should handle headers with getSetCookie method", async () => {
    const mockHeaders = [
      ["content-type", "application/json"],
      ["authorization", "Bearer token"],
    ];
    (mockHeaders as any).getSetCookie = vi.fn();

    const request = {
      url: "http://localhost/users",
      method: "GET",
      headers: mockHeaders,
    } as unknown as Request;

    await httpHandler(request);

    const call = (mockServer.handleRequest as Mock).mock.calls[0][0];

    expect(call.req.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer token",
    });
  });

  test("should parse complex URL paths correctly", async () => {
    const request = new Request(
      "http://localhost/api/v1/users/special-action",
      {
        method: "POST",
        body: JSON.stringify({ payload: { data: "test" } }),
      }
    );

    await httpHandler(request);

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resourceName: "users",
        procedure: "special-action",
      }),
    });
  });
});
