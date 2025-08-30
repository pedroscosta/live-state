import { ClientOptions } from "..";
import {
  ClientMessage,
  MutationMessage,
  type ServerMessage,
  serverMessageSchema,
  syncReplyDataSchema,
} from "../../core/schemas/web-socket";
import { generateId } from "../../core/utils";
import { LiveObjectAny, LiveObjectMutationInput } from "../../schema";
import { AnyRouter } from "../../server";
import { Simplify } from "../../utils";
import type { Client as ClientType } from "../types";
import { createObservable } from "../utils";
import { WebSocketClient } from "../ws-wrapper";
import { OptimisticStore } from "./store";

export type ConnectionStateChangeEvent = {
  type: "CONNECTION_STATE_CHANGE";
  open: boolean;
};

export type MessageReceivedEvent = {
  type: "MESSAGE_RECEIVED";
  message: ServerMessage;
};

export type ClientEvents = ConnectionStateChangeEvent | MessageReceivedEvent;

class InnerClient {
  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly store: OptimisticStore;

  private remoteSubCounters: Record<string, number> = {};

  private eventListeners: Set<(event: ClientEvents) => void> = new Set();

  private replyHandlers: Record<
    string,
    { timeoutHandle: NodeJS.Timeout; handler: (data: any) => void }
  > = {};

  public constructor(opts: ClientOptions) {
    this.url = opts.url;

    this.store = new OptimisticStore(
      opts.schema,
      (opts as { storage: { name: string } }).storage.name,
      (stack) => {
        Object.values(stack)
          ?.flat()
          ?.forEach((m) => this.sendWsMessage(m));
      }
    );

    this.ws = new WebSocketClient({
      url: opts.url,
      autoConnect: true,
      autoReconnect: true,
      reconnectTimeout: 5000,
      credentials: opts.credentials,
    });

    this.ws.addEventListener("message", (e) => {
      this.handleServerMessage(e.data);
    });

    this.ws.addEventListener("connectionChange", (e) => {
      this.emitEvent({
        type: "CONNECTION_STATE_CHANGE",
        open: e.open,
      });

      if (e.open) {
        // TODO move this logic to the Provider
        this.sendWsMessage({
          id: generateId(),
          type: "QUERY",
          // TODO add lastSyncedAt
        });

        Object.entries(this.remoteSubCounters).forEach(([routeName, count]) => {
          if (count > 0) {
            this.sendWsMessage({
              id: generateId(),
              type: "SUBSCRIBE",
              resource: routeName,
            });
          }
        });

        Object.values(this.store.optimisticMutationStack).forEach(
          (mutations) => {
            if (mutations) mutations.forEach((m) => this.sendWsMessage(m));
          }
        );
      }
    });
  }

  public get(path: string[]) {
    if (path.length === 0) throw new Error("Path must not be empty");

    return path.length === 1
      ? this.store.get(path[0])
      : this.store.getOne(path[0], path[1]);
  }

  public handleServerMessage(message: MessageEvent["data"]) {
    try {
      console.log("Message received from the server:", message);
      const parsedMessage = serverMessageSchema.parse(JSON.parse(message));

      console.log("Parsed message:", parsedMessage);

      this.emitEvent({
        type: "MESSAGE_RECEIVED",
        message: parsedMessage,
      });

      if (parsedMessage.type === "MUTATE") {
        const { resource } = parsedMessage;

        try {
          this.store.addMutation(resource, parsedMessage);
        } catch (e) {
          console.error("Error merging mutation from the server:", e);
        }
      } else if (parsedMessage.type === "REJECT") {
        // TODO handle reject
        // this.removeOptimisticMutation(
        //   parsedMessage.resource,
        //   parsedMessage._id,
        //   true
        // );
      } else if (parsedMessage.type === "REPLY") {
        const { id, data } = parsedMessage;

        if (this.replyHandlers[id]) {
          clearTimeout(this.replyHandlers[id].timeoutHandle);
          this.replyHandlers[id].handler(data);
          return;
        }

        const parsedSyncData = syncReplyDataSchema.parse(data);

        this.store.loadConsolidatedState(
          parsedSyncData.resource,
          parsedSyncData.data
        );
      }
    } catch (e) {
      console.error("Error parsing message from the server:", e);
    }
  }

  public subscribeToRemote(routeName: string) {
    this.remoteSubCounters[routeName] =
      (this.remoteSubCounters[routeName] ?? 0) + 1;

    this.sendWsMessage({
      id: generateId(),
      type: "SUBSCRIBE",
      resource: routeName,
    });

    return () => {
      this.remoteSubCounters[routeName] -= 1;

      if (this.remoteSubCounters[routeName] === 0) {
        // TODO add unsubscribe message
      }
    };
  }

  public subscribeToStore(path: string[], listener: () => void) {
    this.store.subscribe(path, listener);
  }

  public mutate(
    routeName: string,
    resourceId: string,
    payload: Partial<
      Omit<Simplify<LiveObjectMutationInput<LiveObjectAny>>["value"], "id">
    >
  ) {
    const mutationMessage: MutationMessage = {
      id: generateId(),
      type: "MUTATE",
      resource: routeName,
      payload: this.store.schema[routeName].encodeMutation(
        "set",
        payload as LiveObjectMutationInput<LiveObjectAny>,
        new Date().toISOString()
      ),
      resourceId,
    };

    this.store?.addMutation(routeName, mutationMessage, true);

    this.sendWsMessage(mutationMessage);
  }

  public genericMutate(routeName: string, procedure: string, payload: any) {
    if (!this.ws || !this.ws.connected())
      throw new Error("WebSocket not connected");

    const mutationMessage: MutationMessage = {
      id: generateId(),
      type: "MUTATE",
      resource: routeName,
      procedure,
      payload,
    };

    this.sendWsMessage(mutationMessage);

    return new Promise((resolve, reject) => {
      this.replyHandlers[mutationMessage.id] = {
        timeoutHandle: setTimeout(() => {
          delete this.replyHandlers[mutationMessage.id];
          reject(new Error("Reply timeout"));
        }, 5000),
        handler: (data: any) => {
          delete this.replyHandlers[mutationMessage.id];
          resolve(data);
        },
      };
    });
  }

  public addEventListener(listener: (event: ClientEvents) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private sendWsMessage(message: ClientMessage) {
    if (this.ws && this.ws.connected()) this.ws.send(JSON.stringify(message));
  }

  private emitEvent(event: ClientEvents) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

export type Client<TRouter extends AnyRouter> = {
  client: {
    ws: WebSocketClient;
    subscribe: (resourceType?: string[]) => () => void;
    addEventListener: (listener: (event: ClientEvents) => void) => () => void;
  };
  store: ClientType<TRouter>;
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): Client<TRouter> => {
  const ogClient = new InnerClient(opts);

  return {
    client: {
      ws: ogClient.ws,
      subscribe: (resourceType?: string[]) => {
        const removeListeners: (() => void)[] = [];

        for (const rt of resourceType ?? Object.keys(ogClient.store.schema)) {
          removeListeners.push(ogClient.subscribeToRemote(rt));
        }

        return () => {
          console.log("Removing listeners", removeListeners);
          removeListeners.forEach((remove) => remove());
        };
      },
      addEventListener: (listener) => {
        return ogClient.addEventListener(listener);
      },
    },
    store: createObservable(() => {}, {
      apply: (_, path, argumentsList) => {
        const selector = path.slice(0, -1);
        const lastSegment = path[path.length - 1];

        if (lastSegment === "get") return ogClient.get(selector);

        if (lastSegment === "subscribe")
          return ogClient.subscribeToStore(selector, argumentsList[0]);

        if (lastSegment === "subscribeToRemote")
          return ogClient.subscribeToRemote(selector[0]);

        if (lastSegment === "insert") {
          const { id, ...rest } = argumentsList[0];
          return ogClient.mutate(selector[0], id, rest);
        }

        if (lastSegment === "update") {
          const [id, input] = argumentsList;
          return ogClient.mutate(selector[0], id, input);
        }

        return ogClient.genericMutate(
          selector[0],
          lastSegment,
          argumentsList[0]
        );
      },
    }) as unknown as Client<TRouter>["store"],
  };
};
