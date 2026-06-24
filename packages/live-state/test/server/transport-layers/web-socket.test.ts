import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import WebSocket from "ws";
import { ClientMessage } from "../../../src/core/schemas/web-socket";
import { generateId } from "../../../src/core/utils";
import { Server } from "../../../src/server";
import { AnyRouter } from "../../../src/server/router";
import { webSocketAdapter } from "../../../src/server/transport-layers/web-socket";

// Mock dependencies
vi.mock("cookie", () => ({
  default: {
    parse: vi.fn().mockReturnValue({ sessionId: "abc123" }),
  },
}));

vi.mock("qs", () => ({
  parse: vi.fn().mockReturnValue({ userId: "user123" }),
}));

vi.mock("../../../src/core/utils", () => ({
  generateId: vi.fn().mockReturnValue("generated-id-123"),
}));

describe("webSocketAdapter", () => {
  let mockServer: Server<AnyRouter>;
  let mockWebSocket: WebSocket;
  let mockRequest: any;
  let wsHandler: (ws: WebSocket, request: any) => void;
  let mutationHandler: (mutation: any) => void;

  beforeEach(() => {
    mockServer = {
      subscribeToMutations: vi.fn().mockImplementation((query, handler) => {
        mutationHandler = handler;
        return vi.fn(); // unsubscribe function
      }),
      contextProvider: vi.fn().mockReturnValue({ userId: "user123" }),
      // Inbound SUBSCRIBE/QUERY are now Custom Query requests (ADR-0002). A
      // subscription resolves to `{ data, query, unsubscribe }`; a one-shot
      // QUERY resolves to the plain handler value.
      handleCustomQuery: vi.fn().mockImplementation((opts: any) =>
        opts?.subscription
          ? {
              data: [
                { value: { id: { value: "user1" }, name: { value: "John" } } },
              ],
              query: { resource: "users" },
              unsubscribe: vi.fn(),
            }
          : [{ id: "user1", name: "John" }],
      ),
      handleMutation: vi.fn().mockResolvedValue({
        data: { name: "John Updated" },
        acceptedValues: { name: "John Updated" },
      }),
      router: {
        routes: {
          users: {},
          posts: {},
        },
      },
      schema: {
        users: { name: "users" },
        posts: { name: "posts" },
      },
      logger: {
        critical: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
    } as unknown as Server<AnyRouter>;

    mockWebSocket = {
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as WebSocket;

    mockRequest = {
      headers: {
        cookie: "sessionId=abc123",
      },
      url: "/ws?userId=user123",
    };

    wsHandler = webSocketAdapter(mockServer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create WebSocket adapter handler", () => {
    expect(typeof wsHandler).toBe("function");
    // subscribeToMutations is now called per connection, not at adapter creation
  });

  test("should setup WebSocket connection with proper event listeners", () => {
    wsHandler(mockWebSocket, mockRequest);

    expect(mockWebSocket.on).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    expect(mockWebSocket.on).toHaveBeenCalledWith(
      "close",
      expect.any(Function),
    );
    expect(generateId).toHaveBeenCalled();
  });

  test("should handle SUBSCRIBE message", async () => {
    wsHandler(mockWebSocket, mockRequest);

    // Get the message handler
    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      procedure: "list",
      id: "msg-1",
    };

    await messageHandler(Buffer.from(JSON.stringify(subscribeMessage)));

    // Verify handleCustomQuery was called with subscription callback
    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({
          type: "CUSTOM_QUERY",
          resource: "users",
          procedure: "list",
          context: { userId: "user123" },
          headers: expect.objectContaining({ cookie: "sessionId=abc123" }),
          cookies: { sessionId: "abc123" },
        }),
        subscription: expect.any(Function),
      }),
    );

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: {
          resource: "users",
          data: [{ id: { value: "user1" }, name: { value: "John" } }],
        },
      }),
    );
  });

  test("should handle QUERY message", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      procedure: "list",
      id: "msg-1",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage)));

    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "CUSTOM_QUERY",
        resource: "users",
        procedure: "list",
        context: { userId: "user123" },
        headers: expect.objectContaining({
          cookie: "sessionId=abc123",
        }),
        cookies: { sessionId: "abc123" },
      }),
    });

    // A one-shot QUERY replies with the handler's plain value
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: [{ id: "user1", name: "John" }],
      }),
    );
  });

  test("should handle QUERY message without specified resources", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const queryMessage1 = {
      type: "QUERY",
      id: "msg-1",
      resource: "users",
      procedure: "list",
    } satisfies ClientMessage;
    const queryMessage2 = {
      type: "QUERY",
      id: "msg-2",
      resource: "posts",
      procedure: "list",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage1)));
    await messageHandler(Buffer.from(JSON.stringify(queryMessage2)));

    expect(mockServer.handleCustomQuery).toHaveBeenCalledTimes(2);
    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        resource: "users",
      }),
    });
    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        resource: "posts",
      }),
    });
  });

  test("should reply to MUTATE message with default insert/update procedure", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const mutateMessage = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: {
        name: {
          value: "John Updated",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
      meta: { timestamp: "2023-01-03T00:00:00.000Z" },
      id: "msg-1",
      procedure: "INSERT",
    };

    (mockServer.handleMutation as Mock).mockResolvedValue({
      data: { name: "John Updated" },
      acceptedValues: { name: "John Updated" },
    });

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

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
        procedure: "INSERT",
        meta: { timestamp: "2023-01-03T00:00:00.000Z" },
        context: expect.objectContaining({
          messageId: "msg-1",
        }),
      }),
    });

    // Every MUTATE now receives a reply unconditionally
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: {
          data: { name: "John Updated" },
          acceptedValues: { name: "John Updated" },
        },
      }),
    );
  });

  test("should handle MUTATE message with custom procedure", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const mutateMessage = {
      type: "MUTATE",
      resource: "users",
      procedure: "approve",
      payload: { status: "approved" },
      id: "msg-1",
    };

    (mockServer.handleMutation as Mock).mockResolvedValue({
      success: true,
    });

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resource: "users",
        procedure: "approve",
        input: { status: "approved" },
      }),
    });

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: { success: true },
      }),
    );
  });

  test("should keep generic insert procedure when a custom mutation exists", async () => {
    const customHandler = vi.fn();
    (mockServer as any).router.routes.users.customMutations = {
      insert: { handler: customHandler },
    };

    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const mutateMessage = {
      type: "MUTATE",
      resource: "users",
      procedure: "insert",
      payload: { id: "user1", name: "Alice" },
      id: "msg-1",
    };

    (mockServer.handleMutation as Mock).mockResolvedValue({ ok: true });

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

    expect(mockServer.handleMutation).toHaveBeenCalledWith({
      req: expect.objectContaining({
        procedure: "insert",
        input: { id: "user1", name: "Alice" },
      }),
    });

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: { ok: true },
      }),
    );
  });

  test("should handle MUTATE message error", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const mutateMessage = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      payload: {
        name: {
          value: "John Updated",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
      id: "msg-1",
      procedure: "INSERT",
    };

    (mockServer.handleMutation as Mock).mockRejectedValue(
      new Error("Validation failed"),
    );

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REJECT",
        resource: "users",
        message: "Validation failed",
      }),
    );
  });

  test("should handle invalid JSON message", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    // This should not throw an error, just log it
    await messageHandler(Buffer.from("invalid json"));

    // No WebSocket send should be called for invalid messages
    expect(mockWebSocket.send).not.toHaveBeenCalled();
  });

  test("should handle connection close and unsubscribe", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const closeHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "close",
    )?.[1];

    // Create a mock unsubscribe function returned by handleCustomQuery
    const unsubscribe = vi.fn();
    (mockServer.handleCustomQuery as Mock).mockResolvedValueOnce({
      data: [{ value: { id: { value: "user1" }, name: { value: "John" } } }],
      query: { resource: "users" },
      unsubscribe,
    });

    // Subscribe first
    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      procedure: "list",
      id: "msg-1",
    };

    await messageHandler(Buffer.from(JSON.stringify(subscribeMessage)));

    // Now close the connection
    closeHandler?.();

    // Verify unsubscribe was called (indirectly through cleanup)
    // The actual cleanup happens in the adapter, but we verify the structure
    expect(unsubscribe).toHaveBeenCalled();
  });

  test("should not propagate mutations without resourceId", async () => {
    // Setup a WebSocket connection and subscription first
    const ws = { send: vi.fn(), on: vi.fn() } as unknown as WebSocket;
    wsHandler(ws, mockRequest);

    // Subscribe to users resource
    const messageHandler = (ws.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    expect(messageHandler).toBeDefined();

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      procedure: "list",
      id: "sub-1",
    };

    await messageHandler!(Buffer.from(JSON.stringify(subscribeMessage)));

    // Get the subscription handler that was registered
    const subscriptionHandler = (mockServer.handleCustomQuery as Mock).mock.calls
      .map((call) => call[0]?.subscription)
      .find((handler) => typeof handler === "function");

    // Try to propagate mutation without resourceId
    const mutation = {
      type: "SYNC",
      resource: "users",
      payload: {
        name: {
          value: "Updated",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
      // Missing resourceId
    };

    if (subscriptionHandler) {
      subscriptionHandler(mutation);
    }

    // Should not propagate SYNC messages because resourceId is missing
    const forwardedMutations = (ws.send as Mock).mock.calls
      .map((call) => JSON.parse(call[0] as string))
      .filter((message) => message.type === "SYNC");

    expect(forwardedMutations).toHaveLength(0);
  });

  test("should not propagate mutations without payload", async () => {
    // Setup a WebSocket connection and subscription first
    const ws = { send: vi.fn(), on: vi.fn() } as unknown as WebSocket;
    wsHandler(ws, mockRequest);

    // Subscribe to users resource
    const messageHandler = (ws.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    expect(messageHandler).toBeDefined();

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      procedure: "list",
      id: "sub-1",
    };

    await messageHandler!(Buffer.from(JSON.stringify(subscribeMessage)));

    // Get the subscription handler that was registered
    const subscriptionHandler = (mockServer.handleCustomQuery as Mock).mock.calls
      .map((call) => call[0]?.subscription)
      .find((handler) => typeof handler === "function");

    // Try to propagate mutation without payload
    const mutation = {
      type: "SYNC",
      resource: "users",
      resourceId: "user1",
      // Missing payload
    };

    if (subscriptionHandler) {
      subscriptionHandler(mutation);
    }

    // Should not propagate SYNC messages because payload is missing
    const forwardedMutations = (ws.send as Mock).mock.calls
      .map((call) => JSON.parse(call[0] as string))
      .filter((message) => message.type === "SYNC");

    expect(forwardedMutations).toHaveLength(0);
  });

  test("should handle context provider returning promise", async () => {
    (mockServer.contextProvider as Mock).mockReturnValue(
      Promise.resolve({ userId: "async-user" }),
    );

    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      procedure: "list",
      id: "msg-1",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage)));

    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: { userId: "async-user" },
      }),
    });
  });

  test("should handle missing context provider", async () => {
    mockServer.contextProvider = undefined;

    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      procedure: "list",
      id: "msg-1",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage)));

    expect(mockServer.handleCustomQuery).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: {},
      }),
    });
  });

  test("should handle request without cookies", () => {
    const requestWithoutCookies = {
      headers: {},
      url: "/ws?userId=user123",
    };

    wsHandler(mockWebSocket, requestWithoutCookies);

    // Should not throw an error
    expect(mockWebSocket.on).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  test("should handle request URL without query parameters", () => {
    const requestWithoutQuery = {
      headers: { cookie: "sessionId=abc123" },
      url: "/ws",
    };

    wsHandler(mockWebSocket, requestWithoutQuery);

    // Should not throw an error
    expect(mockWebSocket.on).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });

  test("should handle QUERY message with server error", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message",
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      procedure: "list",
      id: "msg-1",
    } satisfies ClientMessage;

    (mockServer.handleCustomQuery as Mock).mockResolvedValue(null);

    await expect(
      messageHandler(Buffer.from(JSON.stringify(queryMessage))),
    ).resolves.toBeUndefined();
  });
});
