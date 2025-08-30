import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocketClient } from "../../src/client/ws-wrapper";
import { consumeGeneratable } from "../../src/core/utils";

// Mock the WebSocket class
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CLOSED;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  eventListeners: Record<string, Array<(event: any) => void>> = {};

  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
  }

  addEventListener(event: string, callback: (event: any) => void): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  removeEventListener(event: string, callback: (event: any) => void): void {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter(
        (cb) => cb !== callback
      );
    }
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.eventListeners[event.type] || [];
    listeners.forEach((listener) => listener(event));
    return true;
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close"));
  });

  // Helper methods for testing
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  simulateError(): void {
    this.dispatchEvent(new Event("error"));
  }

  simulateMessage(data: any): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

// Mock the global WebSocket
vi.stubGlobal("WebSocket", MockWebSocket);

// Mock the consumeGeneratable function
vi.mock("../../src/core/utils", () => ({
  consumeGeneratable: vi.fn().mockImplementation(async (value) => value)
}));

// Mock setTimeout and clearTimeout
vi.useFakeTimers();

describe("WebSocketClient", () => {
  let client: WebSocketClient;
  const mockUrl = "ws://localhost:8080";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe("constructor", () => {
    test("should initialize with default options", () => {
      client = new WebSocketClient({ url: mockUrl });
      expect(client).toBeDefined();
      expect(client.connected()).toBe(false);
    });

    test("should auto-connect when autoConnect is true", () => {
      client = new WebSocketClient({ url: mockUrl, autoConnect: true });
      expect(client).toBeDefined();
      // The WebSocket is created but not yet open
      expect(client.connected()).toBe(false);
    });

    test("should initialize with custom options", () => {
      const options = {
        url: mockUrl,
        autoConnect: false,
        autoReconnect: true,
        reconnectTimeout: 3000,
        reconnectLimit: 5,
        credentials: { token: "test-token" },
      };
      client = new WebSocketClient(options);
      expect(client).toBeDefined();
      expect(client.connected()).toBe(false);
    });
  });

  describe("connect", () => {
    test("should connect to WebSocket server", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      // Get the mock WebSocket instance
      const ws = (client as any).ws as MockWebSocket;
      expect(ws).toBeDefined();
      expect(ws.url).toBe(mockUrl);

      // Simulate WebSocket open event
      ws.simulateOpen();
      expect(client.connected()).toBe(true);
    });

    test("should not reconnect if already connected", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();

      // Store the original WebSocket instance
      const originalWs = (client as any).ws;

      // Try to connect again
      await client.connect();

      // Should still be the same WebSocket instance
      expect((client as any).ws).toBe(originalWs);
    });

    test("should append credentials to URL when provided", async () => {
      const credentials = { token: "test-token" };
      client = new WebSocketClient({ url: mockUrl, credentials });

      await client.connect();

      expect(consumeGeneratable).toHaveBeenCalledWith(credentials);
      const ws = (client as any).ws as MockWebSocket;
      expect(ws.url).toBe(`${mockUrl}?token=test-token`);
    });
  });

  describe("disconnect", () => {
    test("should disconnect from WebSocket server", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();

      client.disconnect();

      expect(ws.close).toHaveBeenCalled();
      expect(client.connected()).toBe(false);
      expect((client as any).ws).toBeNull();
      expect((client as any).intentionallyDisconnected).toBe(true);
    });

    test("should clear reconnect timer when disconnecting", async () => {
      client = new WebSocketClient({ url: mockUrl, autoReconnect: true });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();
      ws.simulateClose();

      // A reconnect should be scheduled now
      expect((client as any).reconnectTimer).not.toBeNull();

      client.disconnect();

      // Reconnect timer should be cleared
      expect((client as any).reconnectTimer).toBeNull();
    });
  });

  describe("event handling", () => {
    test("should add and trigger event listeners", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;

      const openCallback = vi.fn();
      const messageCallback = vi.fn();

      client.addEventListener("open", openCallback);
      client.addEventListener("message", messageCallback);

      ws.simulateOpen();
      expect(openCallback).toHaveBeenCalled();

      const testData = { test: "data" };
      ws.simulateMessage(testData);
      expect(messageCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: testData,
        })
      );
    });

    test("should remove event listeners", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;

      const messageCallback = vi.fn();

      client.addEventListener("message", messageCallback);
      client.removeEventListener("message", messageCallback);

      ws.simulateMessage("test");
      expect(messageCallback).not.toHaveBeenCalled();
    });

    test("should dispatch connectionChange events", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;

      const connectionChangeCallback = vi.fn();
      client.addEventListener("connectionChange", connectionChangeCallback);

      ws.simulateOpen();
      expect(connectionChangeCallback).toHaveBeenCalledWith({ open: true });

      ws.simulateClose();
      expect(connectionChangeCallback).toHaveBeenCalledWith({ open: false });
    });
  });

  describe("send", () => {
    test("should send data when connected", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();

      const testData = "test data";
      client.send(testData);

      expect(ws.send).toHaveBeenCalledWith(testData);
    });

    test("should throw error when not connected", async () => {
      client = new WebSocketClient({ url: mockUrl });
      await client.connect();

      // WebSocket is not open yet
      expect(() => client.send("test")).toThrow("WebSocket is not open");
    });
  });

  describe("auto-reconnect", () => {
    test("should attempt to reconnect when connection closes", async () => {
      // Create a spy for the connect method to track calls
      const connectSpy = vi.spyOn(WebSocketClient.prototype, "connect");

      client = new WebSocketClient({
        url: mockUrl,
        autoReconnect: true,
        reconnectTimeout: 1000,
      });

      // Initial connect call
      await client.connect();
      expect(connectSpy).toHaveBeenCalledTimes(1);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();
      ws.simulateClose();

      // Should schedule a reconnect
      expect((client as any).reconnectTimer).not.toBeNull();
      expect((client as any).reconnectAttempts).toBe(1);

      // Fast-forward time to trigger reconnect
      vi.advanceTimersByTime(1000);

      // Connect should be called again for reconnection
      expect(connectSpy).toHaveBeenCalledTimes(2);

      // Clean up
      connectSpy.mockRestore();
    });

    test("should stop reconnecting after reaching reconnect limit", async () => {
      // Create a spy for the connect method to track calls
      const connectSpy = vi.spyOn(WebSocketClient.prototype, "connect");

      // Create client with reconnect limit of 2
      client = new WebSocketClient({
        url: mockUrl,
        autoReconnect: true,
        reconnectTimeout: 1000,
        reconnectLimit: 2,
      });

      // Initial connect
      await client.connect();
      expect(connectSpy).toHaveBeenCalledTimes(1);

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();
      ws.simulateClose();

      // First reconnect attempt
      vi.advanceTimersByTime(1000);
      expect(connectSpy).toHaveBeenCalledTimes(2);

      // Get the new WebSocket and simulate close again
      const newWs = (client as any).ws as MockWebSocket;
      newWs.simulateClose();

      // Second reconnect attempt
      vi.advanceTimersByTime(1000);
      expect(connectSpy).toHaveBeenCalledTimes(3);

      // Get the third WebSocket and simulate close
      const thirdWs = (client as any).ws as MockWebSocket;
      thirdWs.simulateClose();

      // Should not schedule another reconnect (limit reached)
      expect((client as any).reconnectAttempts).toBe(2);
      vi.advanceTimersByTime(1000);

      // Connect should not be called again
      expect(connectSpy).toHaveBeenCalledTimes(3);

      // Clean up
      connectSpy.mockRestore();
    });

    test("should reset reconnect attempts on successful connection", async () => {
      client = new WebSocketClient({
        url: mockUrl,
        autoReconnect: true,
        reconnectTimeout: 1000,
      });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateClose();

      // First reconnect attempt
      expect((client as any).reconnectAttempts).toBe(1);
      vi.advanceTimersByTime(1000);

      const newWs = (client as any).ws as MockWebSocket;
      newWs.simulateOpen();

      // Reconnect attempts should be reset
      expect((client as any).reconnectAttempts).toBe(0);
    });

    test("should not reconnect after intentional disconnect", async () => {
      client = new WebSocketClient({
        url: mockUrl,
        autoReconnect: true,
      });
      await client.connect();

      const ws = (client as any).ws as MockWebSocket;
      ws.simulateOpen();

      client.disconnect();

      // Should not schedule a reconnect
      expect((client as any).reconnectTimer).toBeNull();
      expect((client as any).intentionallyDisconnected).toBe(true);
    });
  });
});
