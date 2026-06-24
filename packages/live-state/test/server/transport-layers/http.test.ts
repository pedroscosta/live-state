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
      // The GET Default Query path was removed (ADR-0002); reads now go through
      // POST `/<resource>/query/<procedure>` → `handleCustomQuery`.
      handleCustomQuery: vi.fn().mockResolvedValue([{ name: "John" }]),
      handleMutation: vi.fn().mockResolvedValue({
        data: { name: "John Updated" },
        acceptedValues: { name: "John Updated" },
      }),
      logger: {
        critical: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as Server<AnyRouter>;

    httpHandler = httpTransportLayer(mockServer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create HTTP transport layer handler", () => {
    expect(typeof httpHandler).toBe("function");
  });

  test("should handle POST custom query successfully", async () => {
    const request = new Request("http://localhost/users/query/list", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "sessionId=abc123",
      },
      body: JSON.stringify({ input: { status: "active" } }),
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(200);
    expect(responseData).toEqual([{ name: "John" }]);
    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "CUSTOM_QUERY",
        resource: "users",
        procedure: "list",
        input: { status: "active" },
        context: { userId: "user123" },
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
        cookies: { sessionId: "abc123" },
      }),
    });
  });

  test("should handle POST request for insert mutation", async () => {
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
      meta: {
        timestamp: "2023-01-03T00:00:00.000Z",
      },
    };

    const request = new Request("http://localhost/users/insert", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    (mockServer.handleMutation as Mock).mockResolvedValue({
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

    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resource: "users",
        input: {
          name: {
            value: "John Updated",
            _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
          },
        },
        resourceId: "user1",
        procedure: "insert",
        meta: { timestamp: "2023-01-03T00:00:00.000Z" },
      }),
    });
  });

  test("should handle POST request for insert mutation with generic shape", async () => {
    const requestBody = {
      payload: {
        name: {
          value: "John Generic",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
      meta: { timestamp: "2023-01-03T00:00:00.000Z" },
    };

    const request = new Request("http://localhost/users/insert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    (mockServer.handleMutation as Mock).mockResolvedValue({
      data: { name: "John Generic" },
      acceptedValues: { name: "John Generic" },
    });

    const response = await httpHandler(request);

    expect(response.status).toBe(200);
    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resource: "users",
        procedure: "insert",
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

    (mockServer.handleMutation as Mock).mockResolvedValue({
      success: true,
    });

    const response = await httpHandler(request);
    const responseData = await response.json();

    expect(response.status).toBe(200);
    expect(responseData).toEqual({ success: true });
    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resource: "users",
        input: { action: "approve" },
        procedure: "approve",
      }),
    });
  });

  test("should return 400 for non-object mutation body", async () => {
    const request = new Request("http://localhost/users/insert", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify("not-an-object"),
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

    const request = new Request("http://localhost/users/query/list", {
      method: "POST",
      body: JSON.stringify({ input: {} }),
    });

    await httpHandler(request);

    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: {},
      }),
    });
  });

  test("should handle requests without cookies", async () => {
    const request = new Request("http://localhost/users/query/list", {
      method: "POST",
      body: JSON.stringify({ input: {} }),
    });

    await httpHandler(request);

    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        cookies: {},
      }),
    });
  });

  test("should treat a POST request without body as a no-input mutation", async () => {
    const request = new Request("http://localhost/users/doThing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });

    (mockServer.handleMutation as Mock).mockResolvedValue({ ok: true });

    const response = await httpHandler(request);

    expect(response.status).toBe(200);
    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resource: "users",
        procedure: "doThing",
        input: undefined,
      }),
    });
  });

  test("should return 500 for unexpected errors", async () => {
    const request = new Request("http://localhost/users/query/list", {
      method: "POST",
      body: JSON.stringify({ input: {} }),
    });

    (mockServer.handleCustomQuery as Mock).mockRejectedValue(
      new Error("Unexpected error"),
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
      url: "http://localhost/users/query/list",
      method: "POST",
      headers: mockHeaders,
      body: JSON.stringify({ input: {} }),
      json: async () => ({ input: {} }),
    } as unknown as Request;

    await httpHandler(request);

    const call = (mockServer.handleCustomQuery as Mock).mock.calls[0][0];

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
      },
    );

    await httpHandler(request);

    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resource: "users",
        procedure: "special-action",
      }),
    });
  });
});
