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
      subscribeToMutations: vi.fn().mockImplementation((handler) => {
        mutationHandler = handler;
        return vi.fn(); // unsubscribe function
      }),
      contextProvider: vi.fn().mockReturnValue({ userId: "user123" }),
      handleRequest: vi.fn().mockResolvedValue({
        data: { user1: { value: { name: "John" } } },
      }),
      schema: {
        users: { name: "users" },
        posts: { name: "posts" },
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
    expect(mockServer.subscribeToMutations).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  test("should setup WebSocket connection with proper event listeners", () => {
    wsHandler(mockWebSocket, mockRequest);

    expect(mockWebSocket.on).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );
    expect(mockWebSocket.on).toHaveBeenCalledWith(
      "close",
      expect.any(Function)
    );
    expect(generateId).toHaveBeenCalled();
  });

  test("should handle SUBSCRIBE message", async () => {
    wsHandler(mockWebSocket, mockRequest);

    // Get the message handler
    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      id: "msg-1",
    };

    await messageHandler(Buffer.from(JSON.stringify(subscribeMessage)));

    // Verify subscription was registered (we can't directly test internal state,
    // but we can verify no errors were thrown)
    expect(mockWebSocket.send).not.toHaveBeenCalled();
  });

  test("should handle QUERY message", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      id: "msg-1",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage)));

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "QUERY",
        resourceName: "users",
        context: { userId: "user123" },
        headers: expect.objectContaining({
          cookie: "sessionId=abc123",
        }),
        cookies: { sessionId: "abc123" },
      }),
    });

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: {
          resource: "users",
          data: { user1: { name: "John" } },
        },
      })
    );
  });

  test("should handle QUERY message without specified resources", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const queryMessage1 = {
      type: "QUERY",
      id: "msg-1",
      resource: "users",
    } satisfies ClientMessage;
    const queryMessage2 = {
      type: "QUERY",
      id: "msg-2",
      resource: "posts",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage1)));
    await messageHandler(Buffer.from(JSON.stringify(queryMessage2)));

    // Should query all resources in schema
    expect(mockServer.handleRequest).toHaveBeenCalledTimes(2);
    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        resourceName: "users",
      }),
    });
    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        resourceName: "posts",
      }),
    });
  });

  test("should handle MUTATE message with default mutation", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
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

    (mockServer.handleRequest as Mock).mockResolvedValue({
      data: { name: "John Updated" },
      acceptedValues: { name: "John Updated" },
    });

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

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
        procedure: "INSERT",
        context: expect.objectContaining({
          messageId: "msg-1",
        }),
      }),
    });

    // Should not send reply for default mutations
    expect(mockWebSocket.send).not.toHaveBeenCalled();
  });

  test("should handle MUTATE message with custom procedure", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const mutateMessage = {
      type: "MUTATE",
      resource: "users",
      procedure: "approve",
      payload: { status: "approved" },
      id: "msg-1",
    };

    (mockServer.handleRequest as Mock).mockResolvedValue({
      success: true,
    });

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        type: "MUTATE",
        resourceName: "users",
        procedure: "approve",
        input: { status: "approved" },
      }),
    });

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REPLY",
        data: { success: true },
      })
    );
  });

  test("should handle MUTATE message error", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
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

    (mockServer.handleRequest as Mock).mockRejectedValue(
      new Error("Validation failed")
    );

    await messageHandler(Buffer.from(JSON.stringify(mutateMessage)));

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        id: "msg-1",
        type: "REJECT",
        resource: "users",
        message: "Validation failed",
      })
    );
  });

  test("should handle invalid JSON message", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    // This should not throw an error, just log it
    await messageHandler(Buffer.from("invalid json"));

    // No WebSocket send should be called for invalid messages
    expect(mockWebSocket.send).not.toHaveBeenCalled();
  });

  test("should handle connection close", () => {
    wsHandler(mockWebSocket, mockRequest);

    const closeHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "close"
    )?.[1];

    closeHandler?.();

    // Should clean up connections and subscriptions
    // We can't directly test internal state, but verify no errors are thrown
    expect(closeHandler).toBeDefined();
  });

  test("should not propagate mutations without resourceId", async () => {
    // Setup a WebSocket connection and subscription first
    const ws = { send: vi.fn(), on: vi.fn() } as unknown as WebSocket;
    wsHandler(ws, mockRequest);

    // Subscribe to users resource
    const messageHandler = (ws.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    expect(messageHandler).toBeDefined();

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      id: "sub-1",
    };

    await messageHandler!(Buffer.from(JSON.stringify(subscribeMessage)));

    // Try to propagate mutation without resourceId
    const mutation = {
      type: "MUTATE",
      resource: "users",
      payload: {
        name: {
          value: "Updated",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
      // Missing resourceId
    };

    mutationHandler(mutation);

    // Should not send any message because resourceId is missing
    expect(ws.send).not.toHaveBeenCalled();
  });

  test("should not propagate mutations without payload", async () => {
    // Setup a WebSocket connection and subscription first
    const ws = { send: vi.fn(), on: vi.fn() } as unknown as WebSocket;
    wsHandler(ws, mockRequest);

    // Subscribe to users resource
    const messageHandler = (ws.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    expect(messageHandler).toBeDefined();

    const subscribeMessage = {
      type: "SUBSCRIBE",
      resource: "users",
      id: "sub-1",
    };

    await messageHandler!(Buffer.from(JSON.stringify(subscribeMessage)));

    // Try to propagate mutation without payload
    const mutation = {
      type: "MUTATE",
      resource: "users",
      resourceId: "user1",
      // Missing payload
    };

    mutationHandler(mutation);

    // Should not send any message because payload is missing
    expect(ws.send).not.toHaveBeenCalled();
  });

  test("should handle context provider returning promise", async () => {
    (mockServer.contextProvider as Mock).mockReturnValue(
      Promise.resolve({ userId: "async-user" })
    );

    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      id: "msg-1",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage)));

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
      req: expect.objectContaining({
        context: { userId: "async-user" },
      }),
    });
  });

  test("should handle missing context provider", async () => {
    mockServer.contextProvider = undefined;

    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resource: "users",
      id: "msg-1",
    } satisfies ClientMessage;

    await messageHandler(Buffer.from(JSON.stringify(queryMessage)));

    expect(mockServer.handleRequest).toHaveBeenCalledWith({
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
      expect.any(Function)
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
      expect.any(Function)
    );
  });

  test("should handle QUERY message with server error", async () => {
    wsHandler(mockWebSocket, mockRequest);

    const messageHandler = (mockWebSocket.on as Mock).mock.calls.find(
      (call) => call[0] === "message"
    )?.[1];

    const queryMessage = {
      type: "QUERY",
      resources: ["users"],
      id: "msg-1",
    };

    (mockServer.handleRequest as Mock).mockResolvedValue(null);

    await expect(
      messageHandler(Buffer.from(JSON.stringify(queryMessage)))
    ).resolves.toBeUndefined();
  });
});
