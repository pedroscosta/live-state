import type { z } from "zod";
import type { RawQueryRequest } from "../../core/schemas/core-protocol";
import {
  type ClientMessage,
  type clQueryMsgSchema,
  type MutationMessage,
  type ServerMessage,
  serverMessageSchema,
  syncReplyDataSchema,
} from "../../core/schemas/web-socket";
import { generateId } from "../../core/utils";
import type { LiveObjectAny, LiveObjectMutationInput } from "../../schema";
import type { AnyRouter } from "../../server";
import type { Simplify } from "../../utils";
import type { ClientOptions } from "..";
import { QueryBuilder, type QueryExecutor } from "../query";
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

class InnerClient implements QueryExecutor {
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

    this.store = new OptimisticStore(opts.schema, opts.storage, (stack) => {
      Object.values(stack)
        ?.flat()
        ?.forEach((m) => {
          this.sendWsMessage(m);
        });
    });

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
        Object.keys(this.store.schema).forEach((routeName) => {
          this.sendWsMessage({
            id: generateId(),
            type: "QUERY",
            resource: routeName,
            // TODO add lastSyncedAt
          });
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
            if (mutations)
              mutations.forEach((m) => {
                this.sendWsMessage(m);
              });
          }
        );
      }
    });
  }

  public get(query: RawQueryRequest) {
    return this.store.get(query);
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

  public subscribe(
    query: z.infer<typeof clQueryMsgSchema>,
    callback: (value: any[]) => void
  ) {
    return this.store.subscribe(query, callback);
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
    if (this.ws?.connected()) this.ws.send(JSON.stringify(message));
  }

  private emitEvent(event: ClientEvents) {
    this.eventListeners.forEach((listener) => {
      listener(event);
    });
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
          removeListeners.forEach((remove) => {
            remove();
          });
        };
      },
      addEventListener: (listener) => {
        return ogClient.addEventListener(listener);
      },
    },
    store: {
      query: Object.entries(opts.schema).reduce(
        (acc, [key, value]) => {
          acc[key as keyof TRouter["routes"]] = QueryBuilder._init(
            value,
            ogClient
          );
          return acc;
        },
        {} as Record<
          keyof TRouter["routes"],
          QueryBuilder<
            TRouter["routes"][keyof TRouter["routes"]]["_resourceSchema"]
          >
        >
      ),
      mutate: createObservable(() => {}, {
        apply: (_, path, argumentsList) => {
          if (path.length < 2) return;
          if (path.length > 2)
            throw new Error("Trying to access an invalid path");

          const [route, method] = path;

          if (method === "insert") {
            const { id, ...input } = argumentsList[0];
            return ogClient.mutate(route, id, input);
          }

          if (method === "update") {
            const [id, input] = argumentsList;
            return ogClient.mutate(route, id, input);
          }

          return ogClient.genericMutate(route, method, argumentsList[0]);
        },
      }) as unknown as ClientType<TRouter>["mutate"],
    },
  };
};
