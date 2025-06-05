import { stringify } from "qs";

import { ClientOptions } from ".";
import { consumeGeneratable } from "../core/utils";

export type WebSocketClientEventMap = WebSocketEventMap & {
  connectionChange: {
    open: boolean;
  };
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private autoConnect: boolean;
  private autoReconnect: boolean;
  private reconnectTimeout: number;
  private reconnectLimit?: number;
  private reconnectAttempts: number = 0;
  private eventListeners: Map<string, Set<Function>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionallyDisconnected: boolean = false;
  private credentials?: ClientOptions["credentials"];

  constructor(options: {
    url: string;
    autoConnect?: boolean;
    autoReconnect?: boolean;
    reconnectTimeout?: number;
    reconnectLimit?: number;
    credentials?: ClientOptions["credentials"];
  }) {
    this.url = options.url;
    this.autoConnect = options.autoConnect ?? false;
    this.autoReconnect = options.autoReconnect ?? false;
    this.reconnectTimeout = options.reconnectTimeout ?? 5000;
    this.reconnectLimit = options.reconnectLimit;
    this.credentials = options.credentials;

    if (this.autoConnect) {
      this.connect();
    }
  }

  public connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public async connect(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.intentionallyDisconnected = false;
    const credentials = await consumeGeneratable(this.credentials);

    this.ws = new WebSocket(
      this.url + (credentials ? `?${stringify(credentials)}` : "")
    );

    this.ws.addEventListener("open", this.handleOpen.bind(this));
    this.ws.addEventListener("close", this.handleClose.bind(this));
    this.ws.addEventListener("error", this.handleError.bind(this));
    this.ws.addEventListener("message", this.handleMessage.bind(this));
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionallyDisconnected = true;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public addEventListener<K extends keyof WebSocketClientEventMap>(
    event: K,
    callback: (event: WebSocketClientEventMap[K]) => void
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  public removeEventListener<K extends keyof WebSocketClientEventMap>(
    event: K,
    callback: (event: WebSocketClientEventMap[K]) => void
  ): void {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event)!.delete(callback);
    }
  }

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      throw new Error("WebSocket is not open");
    }
  }

  private handleOpen(event: Event): void {
    this.reconnectAttempts = 0;

    this.dispatchEvent("open", event);
    this.dispatchEvent("connectionChange", { open: true });
  }

  private handleClose(event: CloseEvent): void {
    this.dispatchEvent("close", event);
    this.dispatchEvent("connectionChange", { open: false });

    if (this.autoReconnect && !this.intentionallyDisconnected) {
      this.scheduleReconnect();
    }
  }

  private handleError(event: Event): void {
    this.dispatchEvent("error", event);
  }

  private handleMessage(event: MessageEvent): void {
    this.dispatchEvent("message", event);
  }

  private scheduleReconnect(): void {
    if (this.reconnectLimit && this.reconnectAttempts >= this.reconnectLimit) {
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectTimeout);
  }

  private dispatchEvent<K extends keyof WebSocketClientEventMap>(
    event: K,
    data: WebSocketClientEventMap[K]
  ): void {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event)!.forEach((callback) => {
        callback(data);
      });
    }
  }
}
