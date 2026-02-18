import type { z } from "zod";
import { QueryBuilder, type QueryExecutor } from "../../core/query";
import type {
  CustomQueryRequest,
  RawQueryRequest,
} from "../../core/schemas/core-protocol";
import {
  type ClientMessage,
  type clQueryMsgSchema,
  type DefaultMutationMessage,
  type MutationMessage,
  type ServerMessage,
  serverMessageSchema,
  syncReplyDataSchema,
} from "../../core/schemas/web-socket";
import { generateId } from "../../core/utils";
import type {
  LiveObjectAny,
  LiveObjectMutationInput,
  Schema,
} from "../../schema";
import {
  createLogger,
  hash,
  type Logger,
  LogLevel,
  type Simplify,
} from "../../utils";
import type { ClientOptions } from "..";
import {
  createOptimisticStorageProxy,
  type OptimisticMutationsRegistry,
  type OptimisticOperation,
} from "../optimistic";
import type { ClientRouterConstraint, Client as ClientType } from "../types";
import { createObservable } from "../utils";
import { WebSocketClient } from "../ws-wrapper";
import { OptimisticStore } from "./store";

interface WebSocketClientOptions<TSchema extends Schema<any> = Schema<any>>
  extends ClientOptions<TSchema> {
  connection?: {
    autoConnect?: boolean;
    autoReconnect?: boolean;
    reconnectTimeout?: number;
    maxReconnectAttempts?: number;
  };
}

export type ConnectionStateChangeEvent = {
  type: "CONNECTION_STATE_CHANGE";
  open: boolean;
};

export type MessageReceivedEvent = {
  type: "MESSAGE_RECEIVED";
  message: ServerMessage;
};

export type ClientStorageLoadedEvent = {
  type: "CLIENT_STORAGE_LOADED";
  resource: string;
  itemCount: number;
};

export type DataLoadRequestedEvent = {
  type: "DATA_LOAD_REQUESTED";
  query: RawQueryRequest | CustomQueryRequest;
  subscriptionId: string;
};

export type DataLoadReplyEvent = {
  type: "DATA_LOAD_REPLY";
  resource: string;
  itemCount: number;
  subscriptionId?: string;
};

export type MutationSentEvent = {
  type: "MUTATION_SENT";
  mutationId: string;
  resource: string;
  resourceId: string;
  procedure: string;
  optimistic: boolean;
};

export type MutationReceivedEvent = {
  type: "MUTATION_RECEIVED";
  mutationId: string;
  resource: string;
  resourceId: string;
  procedure: string;
};

export type MutationRejectedEvent = {
  type: "MUTATION_REJECTED";
  mutationId: string;
  resource: string;
};

export type SubscriptionCreatedEvent = {
  type: "SUBSCRIPTION_CREATED";
  query: RawQueryRequest | CustomQueryRequest;
  subscriptionKey: string;
  subscriberCount: number;
};

export type SubscriptionRemovedEvent = {
  type: "SUBSCRIPTION_REMOVED";
  query: RawQueryRequest | CustomQueryRequest;
  subscriptionKey: string;
};

export type QueryExecutedEvent = {
  type: "QUERY_EXECUTED";
  query: RawQueryRequest;
  resultCount: number;
};

export type QuerySubscriptionTriggeredEvent = {
  type: "QUERY_SUBSCRIPTION_TRIGGERED";
  query: RawQueryRequest;
};

export type StoreStateUpdatedEvent = {
  type: "STORE_STATE_UPDATED";
  resource: string;
  itemCount: number;
};

export type OptimisticMutationAppliedEvent = {
  type: "OPTIMISTIC_MUTATION_APPLIED";
  mutationId: string;
  resource: string;
  resourceId: string;
  procedure: string;
  pendingMutations: number;
};

export type OptimisticMutationUndoneEvent = {
  type: "OPTIMISTIC_MUTATION_UNDONE";
  mutationId: string;
  resource: string;
  resourceId: string;
  pendingMutations: number;
};

export type ClientEvents =
  | ConnectionStateChangeEvent
  | MessageReceivedEvent
  | ClientStorageLoadedEvent
  | DataLoadRequestedEvent
  | DataLoadReplyEvent
  | MutationSentEvent
  | MutationReceivedEvent
  | MutationRejectedEvent
  | SubscriptionCreatedEvent
  | SubscriptionRemovedEvent
  | QueryExecutedEvent
  | QuerySubscriptionTriggeredEvent
  | StoreStateUpdatedEvent
  | OptimisticMutationAppliedEvent
  | OptimisticMutationUndoneEvent;

class CustomQueryCall<TOutput> implements PromiseLike<TOutput> {
  public constructor(
    private client: InnerClient,
    private query: CustomQueryRequest,
  ) {}

  public buildQueryRequest() {
    return this.query;
  }

  // biome-ignore lint/suspicious/noThenProperty: PromiseLike implementation required for deferred custom queries
  public then<TResult1 = TOutput, TResult2 = never>(
    onfulfilled?: ((value: TOutput) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.client
      .genericQuery<TOutput>(
        this.query.resource,
        this.query.procedure,
        this.query.input,
      )
      .then(onfulfilled, onrejected);
  }
}

class InnerClient implements QueryExecutor {
  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly store: OptimisticStore;
  private readonly logger: Logger;
  private readonly optimisticMutations?: OptimisticMutationsRegistry<any>;

  private remoteSubscriptions: Map<
    string,
    { query: RawQueryRequest | CustomQueryRequest; subCounter: number }
  > = new Map();

  private eventListeners: Set<(event: ClientEvents) => void> = new Set();

  private replyHandlers: Record<
    string,
    {
      timeoutHandle: NodeJS.Timeout;
      handler: (data: any) => void;
      reject?: (error: Error) => void;
    }
  > = {};

  public constructor(opts: WebSocketClientOptions) {
    this.url = opts.url;
    this.logger = createLogger({
      level: opts.logLevel ?? LogLevel.INFO,
    });
    this.optimisticMutations = opts.optimisticMutations;

    this.store = new OptimisticStore(
      opts.schema,
      opts.storage,
      this.logger,
      (stack) => {
        Object.values(stack)
          ?.flat()
          ?.forEach((m) => {
            this.sendWsMessage(m);
          });
      },
      (resource, itemCount) => {
        this.emitEvent({
          type: "CLIENT_STORAGE_LOADED",
          resource,
          itemCount,
        });
      },
      (query) => {
        this.emitEvent({
          type: "QUERY_SUBSCRIPTION_TRIGGERED",
          query,
        });
      },
    );

    this.ws = new WebSocketClient({
      url: opts.url,
      autoConnect: opts.connection?.autoConnect ?? true,
      autoReconnect: opts.connection?.autoReconnect ?? true,
      reconnectTimeout: opts.connection?.reconnectTimeout ?? 5000,
      reconnectLimit: opts.connection?.maxReconnectAttempts,
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
        Array.from(this.remoteSubscriptions.values()).forEach(({ query }) => {
          this.sendWsMessage({
            id: generateId(),
            type: "SUBSCRIBE",
            ...query,
          });
        });

        Object.values(this.store.optimisticMutationStack).forEach(
          (mutations) => {
            if (mutations)
              mutations.forEach((m) => {
                this.emitEvent({
                  type: "MUTATION_SENT",
                  mutationId: m.id,
                  resource: m.resource,
                  resourceId: m.resourceId,
                  procedure: m.procedure ?? "UNKNOWN",
                  optimistic: true,
                });
                this.sendWsMessage(m);
              });
          },
        );
      }
    });
  }

  public get(query: RawQueryRequest) {
    const result = this.store.get(query);
    this.emitEvent({
      type: "QUERY_EXECUTED",
      query,
      resultCount: Array.isArray(result) ? result.length : result ? 1 : 0,
    });
    return result;
  }

  public handleServerMessage(message: MessageEvent["data"]) {
    try {
      this.logger.debug("Message received from the server:", message);
      const parsedMessage = serverMessageSchema.parse(JSON.parse(message));

      this.logger.debug("Parsed message:", parsedMessage);

      this.emitEvent({
        type: "MESSAGE_RECEIVED",
        message: parsedMessage,
      });

      if (parsedMessage.type === "MUTATE") {
        const { resource, id, resourceId, procedure } =
          parsedMessage as DefaultMutationMessage;

        this.emitEvent({
          type: "MUTATION_RECEIVED",
          mutationId: id,
          resource,
          resourceId,
          procedure: procedure ?? "UNKNOWN",
        });

        try {
          this.store.addMutation(
            resource,
            parsedMessage as DefaultMutationMessage,
          );
        } catch (e) {
          this.logger.error("Error merging mutation from the server:", e);
        }
      } else if (parsedMessage.type === "REJECT") {
        if (this.replyHandlers[parsedMessage.id]) {
          clearTimeout(this.replyHandlers[parsedMessage.id].timeoutHandle);
          this.emitUndoEvents(
            this.store.undoCustomMutation(parsedMessage.id),
          );
          const message = parsedMessage.message ?? "Mutation rejected";
          this.replyHandlers[parsedMessage.id].reject?.(new Error(message));
          delete this.replyHandlers[parsedMessage.id];
        }

        const pendingMutations =
          this.store.optimisticMutationStack[parsedMessage.resource]?.length ??
          0;

        const rejectedMutation = this.store.optimisticMutationStack[
          parsedMessage.resource
        ]?.find((m) => m.id === parsedMessage.id);

        this.store.undoMutation(parsedMessage.resource, parsedMessage.id);

        this.emitEvent({
          type: "MUTATION_REJECTED",
          mutationId: parsedMessage.id,
          resource: parsedMessage.resource,
        });

        if (rejectedMutation) {
          this.emitEvent({
            type: "OPTIMISTIC_MUTATION_UNDONE",
            mutationId: parsedMessage.id,
            resource: parsedMessage.resource,
            resourceId: rejectedMutation.resourceId,
            pendingMutations: pendingMutations - 1,
          });
        }
      } else if (parsedMessage.type === "REPLY") {
        const { id, data } = parsedMessage;

        if (this.replyHandlers[id]) {
          clearTimeout(this.replyHandlers[id].timeoutHandle);
          this.replyHandlers[id].handler(data);
          return;
        }

        const parsedSyncData = syncReplyDataSchema.parse(data);

        this.emitEvent({
          type: "DATA_LOAD_REPLY",
          resource: parsedSyncData.resource,
          itemCount: parsedSyncData.data.length,
        });

        this.store.loadConsolidatedState(
          parsedSyncData.resource,
          parsedSyncData.data,
        );

        this.emitEvent({
          type: "STORE_STATE_UPDATED",
          resource: parsedSyncData.resource,
          itemCount: parsedSyncData.data.length,
        });
      }
    } catch (e) {
      this.logger.error("Error parsing message from the server:", e);
    }
  }

  public load(query: RawQueryRequest | CustomQueryRequest) {
    const subscriptionId = generateId();
    const key = hash(query);

    this.emitEvent({
      type: "DATA_LOAD_REQUESTED",
      query,
      subscriptionId,
    });

    this.sendWsMessage({
      id: subscriptionId,
      type: "SUBSCRIBE",
      ...query,
    });

    const isNewSubscription = !this.remoteSubscriptions.has(key);

    if (this.remoteSubscriptions.has(key)) {
      // biome-ignore lint/style/noNonNullAssertion: false positive
      this.remoteSubscriptions.get(key)!.subCounter += 1;
    } else {
      this.remoteSubscriptions.set(key, { query, subCounter: 1 });
    }

    if (isNewSubscription) {
      this.emitEvent({
        type: "SUBSCRIPTION_CREATED",
        query,
        subscriptionKey: key,
        subscriberCount: 1,
      });
    }

    return () => {
      if (this.remoteSubscriptions.has(key)) {
        // biome-ignore lint/style/noNonNullAssertion: false positive
        const subscription = this.remoteSubscriptions.get(key)!;
        subscription.subCounter -= 1;
        // biome-ignore lint/style/noNonNullAssertion: false positive
        if (this.remoteSubscriptions.get(key)!.subCounter <= 0) {
          this.remoteSubscriptions.delete(key);
          this.sendWsMessage({
            id: generateId(),
            type: "UNSUBSCRIBE",
            ...query,
          });

          this.emitEvent({
            type: "SUBSCRIPTION_REMOVED",
            query,
            subscriptionKey: key,
          });
        }
      }
    };
  }

  public subscribe(
    query: z.infer<typeof clQueryMsgSchema>,
    callback: (value: any[]) => void,
  ) {
    return this.store.subscribe(query, callback);
  }

  public mutate(
    routeName: string,
    resourceId: string,
    procedure: "INSERT" | "UPDATE",
    payload: Partial<
      Omit<Simplify<LiveObjectMutationInput<LiveObjectAny>>["value"], "id">
    >,
  ) {
    const mutationMessage: DefaultMutationMessage = {
      id: generateId(),
      type: "MUTATE",
      resource: routeName,
      payload: this.store.schema[routeName].encodeMutation(
        "set",
        payload as LiveObjectMutationInput<LiveObjectAny>,
        new Date().toISOString(),
      ),
      resourceId,
      procedure,
    };

    const pendingMutations =
      (this.store.optimisticMutationStack[routeName]?.length ?? 0) + 1;

    this.store?.addMutation(routeName, mutationMessage, true);

    this.emitEvent({
      type: "OPTIMISTIC_MUTATION_APPLIED",
      mutationId: mutationMessage.id,
      resource: routeName,
      resourceId,
      procedure,
      pendingMutations,
    });

    this.emitEvent({
      type: "MUTATION_SENT",
      mutationId: mutationMessage.id,
      resource: routeName,
      resourceId,
      procedure,
      optimistic: true,
    });

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
      meta: { timestamp: new Date().toISOString() },
    };

    const optimisticHandler = this.optimisticMutations?.getHandler(
      routeName,
      procedure,
    );

    if (optimisticHandler) {
      try {
        const { proxy, getOperations } = createOptimisticStorageProxy(
          this.store,
          this.store.schema,
        );

        optimisticHandler({ input: payload, storage: proxy });

        const operations = getOperations();
        const appliedIds = this.applyOptimisticOperations(operations);
        this.store.registerCustomMutation(mutationMessage.id, appliedIds);

        this.emitEvent({
          type: "MUTATION_SENT",
          mutationId: mutationMessage.id,
          resource: routeName,
          resourceId: "",
          procedure,
          optimistic: true,
        });
      } catch (e) {
        this.logger.error("Error executing optimistic handler:", e);
        this.emitUndoEvents(this.store.undoCustomMutation(mutationMessage.id));
        throw e;
      }
    } else {
      this.emitEvent({
        type: "MUTATION_SENT",
        mutationId: mutationMessage.id,
        resource: routeName,
        resourceId: "",
        procedure,
        optimistic: false,
      });
    }

    this.sendWsMessage(mutationMessage);

    return new Promise((resolve, reject) => {
      this.replyHandlers[mutationMessage.id] = {
        timeoutHandle: setTimeout(() => {
          delete this.replyHandlers[mutationMessage.id];
          this.emitUndoEvents(
            this.store.undoCustomMutation(mutationMessage.id),
          );
          reject(new Error("Reply timeout"));
        }, 5000),
        handler: (data: any) => {
          delete this.replyHandlers[mutationMessage.id];
          this.store.confirmCustomMutation(mutationMessage.id);
          resolve(data);
        },
        reject,
      };
    });
  }

  private applyOptimisticOperations(
    operations: OptimisticOperation[],
  ): Array<{ resource: string; mutationId: string }> {
    const appliedMutations: Array<{ resource: string; mutationId: string }> =
      [];

    try {
      for (const op of operations) {
        const mutationId = generateId();
        const timestamp = new Date().toISOString();

        const mutationMessage: DefaultMutationMessage = {
          id: mutationId,
          type: "MUTATE",
          resource: op.resource,
          resourceId: op.id,
          procedure: op.type === "insert" ? "INSERT" : "UPDATE",
          payload: this.store.schema[op.resource].encodeMutation(
            "set",
            op.data as LiveObjectMutationInput<LiveObjectAny>,
            timestamp,
          ),
        };

        const pendingMutations =
          (this.store.optimisticMutationStack[op.resource]?.length ?? 0) + 1;

        this.store.addMutation(op.resource, mutationMessage, true);

        appliedMutations.push({ resource: op.resource, mutationId });

        this.emitEvent({
          type: "OPTIMISTIC_MUTATION_APPLIED",
          mutationId,
          resource: op.resource,
          resourceId: op.id,
          procedure: op.type === "insert" ? "INSERT" : "UPDATE",
          pendingMutations,
        });
      }

      return appliedMutations;
    } catch (err) {
      for (const { resource, mutationId } of appliedMutations) {
        this.store.undoMutation(resource, mutationId);
      }
      throw err;
    }
  }

  private emitUndoEvents(
    undone: Array<{
      resource: string;
      mutationId: string;
      resourceId: string;
    }>,
  ) {
    for (const { resource, mutationId, resourceId } of undone) {
      const pendingMutations =
        this.store.optimisticMutationStack[resource]?.length ?? 0;

      this.emitEvent({
        type: "OPTIMISTIC_MUTATION_UNDONE",
        mutationId,
        resource,
        resourceId,
        pendingMutations,
      });
    }
  }

  public genericQuery<TOutput = unknown>(
    routeName: string,
    procedure: string,
    input?: any,
  ): Promise<TOutput> {
    if (!this.ws || !this.ws.connected())
      throw new Error("WebSocket not connected");

    const queryMessage = {
      id: generateId(),
      type: "CUSTOM_QUERY" as const,
      resource: routeName,
      procedure,
      input,
    };

    this.sendWsMessage(queryMessage);

    return new Promise<TOutput>((resolve, reject) => {
      this.replyHandlers[queryMessage.id] = {
        timeoutHandle: setTimeout(() => {
          delete this.replyHandlers[queryMessage.id];
          reject(new Error("Reply timeout"));
        }, 5000),
        handler: (data: TOutput) => {
          delete this.replyHandlers[queryMessage.id];
          resolve(data);
        },
        reject,
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

export type Client<TRouter extends ClientRouterConstraint> = {
  client: {
    ws: WebSocketClient;
    addEventListener: (listener: (event: ClientEvents) => void) => () => void;
    load: (query: RawQueryRequest | CustomQueryRequest) => () => void;
  };
  store: ClientType<TRouter>;
};

export const createClient = <TRouter extends ClientRouterConstraint>(
  opts: WebSocketClientOptions,
): Client<TRouter> => {
  const ogClient = new InnerClient(opts);

  const wrapQueryBuilderWithCustomQueries = (
    routeName: string,
    queryBuilder: QueryBuilder<any>,
  ) => {
    return new Proxy(queryBuilder, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        // If it's a string, it's a custom query method
        if (typeof prop === "string") {
          return (input?: any) =>
            new CustomQueryCall(ogClient, {
              resource: routeName,
              procedure: prop,
              input,
            });
        }
        return undefined;
      },
    });
  };

  return {
    client: {
      ws: ogClient.ws,
      load: (query: RawQueryRequest) => {
        return ogClient.load(query);
      },
      addEventListener: (listener) => {
        return ogClient.addEventListener(listener);
      },
    },
    store: {
      query: Object.entries(opts.schema).reduce((acc, [key, value]) => {
        acc[key as keyof TRouter["routes"]] = wrapQueryBuilderWithCustomQueries(
          key,
          QueryBuilder._init(value, ogClient),
        );
        return acc;
      }, {} as any) as ClientType<TRouter>["query"],
      mutate: createObservable(() => {}, {
        apply: (_, path, argumentsList) => {
          if (path.length < 2) return;
          if (path.length > 2)
            throw new Error("Trying to access an invalid path");

          const [route, method] = path;

          if (method === "insert") {
            const { id, ...input } = argumentsList[0];
            return ogClient.mutate(route, id, "INSERT", input);
          }

          if (method === "update") {
            const [id, input] = argumentsList;
            return ogClient.mutate(route, id, "UPDATE", input);
          }

          return ogClient.genericMutate(route, method, argumentsList[0]);
        },
      }) as unknown as ClientType<TRouter>["mutate"],
    },
  };
};
