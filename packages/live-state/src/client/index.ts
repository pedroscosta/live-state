import { z } from "zod";
import {
  ClientMessage,
  DefaultMutationMessage,
  MutationMessage,
  serverMessageSchema,
} from "../core/schemas/web-socket";
import { Awaitable, Generatable, generateId, Promisify } from "../core/utils";
import {
  InferIndex,
  InferLiveObject,
  inferValue,
  LiveObjectAny,
  LiveObjectMutationInput,
  LiveString,
  LiveTypeAny,
  MaterializedLiveType,
  Schema,
} from "../schema";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { GraphNode, ObjectGraph } from "./obj-graph";
import { createObservable } from "./observable";
import { WebSocketClient } from "./web-socket";

export * from "./react";

export type RawObjPool = Record<
  string,
  Record<string, MaterializedLiveType<LiveObjectAny> | undefined> | undefined
>;

export type ClientState<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]:
    | Record<
        InferIndex<TRouter["routes"][K]["_resourceSchema"]>,
        InferLiveObject<TRouter["routes"][K]["_resourceSchema"]>
      >
    | undefined;
};

class InnerClient {
  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly schema: Schema<any>;

  private rawObjPool: RawObjPool = {} as RawObjPool;
  private optimisticMutationStack: Record<string, DefaultMutationMessage[]> =
    {};
  private optimisticObjGraph: ObjectGraph = new ObjectGraph();
  private optimisticRawObjPool: RawObjPool = {} as RawObjPool;

  private resourceTypeSubscriptions: Record<string, Set<() => void>> = {};

  // This is subscriptions count for each route
  private routeSubscriptions: Record<string, number> = {};

  private replyHandlers: Record<
    string,
    { timeoutHandle: NodeJS.Timeout; handler: (data: any) => void }
  > = {};

  public constructor(opts: ClientOptions) {
    this.url = opts.url;
    this.schema = opts.schema;

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
      if (e.open) {
        this.sendWsMessage({
          id: generateId(),
          type: "SYNC",
          // TODO add lastSyncedAt
        });

        Object.entries(this.routeSubscriptions).forEach(
          ([routeName, count]) => {
            if (count > 0) {
              this.sendWsMessage({
                id: generateId(),
                type: "SUBSCRIBE",
                resource: routeName,
              });
            }
          }
        );

        Object.values(this.optimisticMutationStack).forEach((mutations) => {
          if (mutations) mutations.forEach((m) => this.sendWsMessage(m));
        });
      }
    });
  }

  public get(path: string[]) {
    if (path.length === 0) throw new Error("Path must not be empty");

    if (path.length === 1) {
      return Object.fromEntries(
        Object.entries(this.optimisticRawObjPool[path[0]] ?? {}).map(
          ([k, v]) => [k, inferValue(v)]
        )
      );
    }

    const fullObject = this.getFullObject(path[0], path[1]);

    if (!fullObject)
      throw new Error(
        "Object of type " + path[0] + " not found with id " + path[1]
      );

    return inferValue(fullObject);
  }

  public handleServerMessage(message: MessageEvent["data"]) {
    try {
      console.log("Message received from the server:", message);
      const parsedMessage = serverMessageSchema.parse(JSON.parse(message));

      console.log("Parsed message:", parsedMessage);

      if (parsedMessage.type === "MUTATE") {
        const { resource } = parsedMessage;

        try {
          this.addMutation(resource, parsedMessage);
        } catch (e) {
          console.error("Error parsing mutation from the server:", e);
        }
      } else if (parsedMessage.type === "SYNC") {
        const { resource, data } = parsedMessage;

        console.log("Syncing resource:", data, parsedMessage);

        Object.entries(data).forEach(([id, payload]) => {
          this.addMutation(resource, {
            // this id is not used because only this client will see this mutation, so it can be any unique string
            // since resource's ids are already unique, there is no need to generate a new id
            id,
            type: "MUTATE",
            resource,
            resourceId: id,
            payload,
          });
        });
      } else if (parsedMessage.type === "REJECT") {
        // TODO handle reject
        // this.removeOptimisticMutation(
        //   parsedMessage.resource,
        //   parsedMessage._id,
        //   true
        // );
      } else if (parsedMessage.type === "REPLY") {
        const { id, data } = parsedMessage;

        if (!this.replyHandlers[id]) return;

        clearTimeout(this.replyHandlers[id].timeoutHandle);
        this.replyHandlers[id].handler(data);
      }
    } catch (e) {
      console.error("Error parsing message from the server:", e);
    }
  }

  public subscribeToRemote(routeName: string) {
    this.routeSubscriptions[routeName] =
      (this.routeSubscriptions[routeName] ?? 0) + 1;

    this.sendWsMessage({
      id: generateId(),
      type: "SUBSCRIBE",
      resource: routeName,
    });

    return () => {
      this.routeSubscriptions[routeName] -= 1;

      if (this.routeSubscriptions[routeName] === 0) {
        // TODO add unsubscribe message
      }
    };
  }

  public subscribeToSlice(path: string[], listener: () => void) {
    if (path.length === 1) {
      if (!this.resourceTypeSubscriptions[path[0]])
        this.resourceTypeSubscriptions[path[0]] = new Set();

      this.resourceTypeSubscriptions[path[0]].add(listener);

      return () => {
        this.resourceTypeSubscriptions[path[0]].delete(listener);
      };
    }

    if (path.length === 2) {
      const node = this.optimisticObjGraph.getNode(path[1]);

      if (!node) throw new Error("Node not found");

      return this.optimisticObjGraph.subscribe(path[1], listener);
    }

    throw new Error("Not implemented");
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
      payload: this.schema[routeName].encodeMutation(
        "set",
        payload as LiveObjectMutationInput<LiveObjectAny>,
        new Date().toISOString()
      ),
      resourceId,
    };

    this.addMutation(routeName, mutationMessage, true);

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

  private sendWsMessage(message: ClientMessage) {
    if (this.ws && this.ws.connected()) this.ws.send(JSON.stringify(message));
  }

  private addMutation(
    routeName: string,
    mutation: DefaultMutationMessage,
    optimistic: boolean = false
  ) {
    const schema = this.schema[routeName];

    console.log("Adding mutation", mutation);

    if (!schema) throw new Error("Schema not found");

    const prevValue =
      this.optimisticRawObjPool[routeName]?.[mutation.resourceId];

    if (optimistic) {
      (this.optimisticMutationStack[routeName] ??= []).push(mutation);
    } else {
      this.optimisticMutationStack[routeName] = this.optimisticMutationStack?.[
        routeName
      ]?.filter((m) => m.id !== mutation.id);

      (this.rawObjPool[routeName] ??= {})[mutation.resourceId] = {
        value: {
          ...(
            this.schema[routeName].mergeMutation(
              "set",
              mutation.payload as Record<
                string,
                MaterializedLiveType<LiveTypeAny>
              >,
              this.rawObjPool[routeName][mutation.resourceId]
            )[0] as MaterializedLiveType<LiveTypeAny>
          ).value,
          id: { value: mutation.resourceId },
        },
      } as MaterializedLiveType<LiveObjectAny>;
    }

    const rawValue = this.rawObjPool[routeName]?.[mutation.resourceId];

    const newOptimisticValue = (
      this.optimisticMutationStack[routeName] ?? []
    ).reduce((acc, mut) => {
      if (mut.resourceId !== mutation.resourceId) return acc;

      return this.schema[routeName].mergeMutation(
        "set",
        mut.payload as Record<string, MaterializedLiveType<LiveTypeAny>>,
        acc
      )[0];
    }, rawValue);

    if (newOptimisticValue) {
      (this.optimisticRawObjPool[routeName] ??= {})[mutation.resourceId] = {
        value: {
          ...newOptimisticValue.value,
          id: { value: mutation.resourceId },
        },
      } as MaterializedLiveType<LiveTypeAny>;
    }

    if (!this.optimisticObjGraph.hasNode(mutation.resourceId))
      this.optimisticObjGraph.createNode(
        mutation.resourceId,
        routeName as string,
        Object.values(schema.relations).flatMap((k) =>
          k.type === "many" ? [k.foreignColumn] : []
        )
      );

    if (Object.keys(schema.relations).length > 0) {
      // This maps the column name to the relation name (if it's a `one` relation)
      const schemaRelationalFields = Object.fromEntries(
        Object.entries(schema.relations).flatMap(([k, r]) =>
          r.type === "one" ? [[r.relationalColumn as string, k]] : []
        )
      );

      Object.entries(mutation.payload).forEach(([k, v]) => {
        if (!v || !schemaRelationalFields[k]) return;

        const prevRelation = prevValue?.value[
          k as keyof (typeof prevValue)["value"]
        ] as MaterializedLiveType<LiveString> | undefined;

        const [, updatedRelation] = schema.relations[
          schemaRelationalFields[k]
        ].mergeMutation(
          "set",
          v as { value: string; _meta: { timestamp: string } },
          prevRelation
        );

        if (!updatedRelation) return;

        if (!this.optimisticObjGraph.hasNode(updatedRelation.value)) {
          const otherNodeType =
            schema.relations[schemaRelationalFields[k]].entity.name;

          this.optimisticObjGraph.createNode(
            updatedRelation.value,
            otherNodeType,
            Object.values(this.schema[otherNodeType].relations).flatMap((r) =>
              r.type === "many" ? [r.foreignColumn] : []
            )
          );
        }

        if (prevRelation?.value) {
          this.optimisticObjGraph.removeLink(mutation.resourceId, k);
        }

        this.optimisticObjGraph.createLink(
          mutation.resourceId,
          updatedRelation.value,
          k
        );
      });
    }

    this.resourceTypeSubscriptions[routeName as string]?.forEach((listener) =>
      listener()
    );

    this.optimisticObjGraph.notifySubscribers(mutation.resourceId);
  }

  private getFullObject(
    resourceType: string,
    id: string
  ): MaterializedLiveType<LiveObjectAny> | undefined {
    const node = this.optimisticObjGraph.getNode(id);

    if (!node) return;

    const obj = this.optimisticRawObjPool[resourceType]?.[id];

    if (!obj) return;

    return {
      value: {
        ...obj.value,
        ...Object.fromEntries(
          Array.from(node.references.entries()).map(([k, v]) => {
            const otherNode = this.optimisticObjGraph.getNode(v);

            if (!otherNode) return [k, undefined];

            const [relationName, relation] =
              Object.entries(this.schema[resourceType].relations).find(
                (r) => r[1].relationalColumn === k || r[1].foreignColumn === k
              ) ?? [];

            const otherNodeType = relation?.entity.name;

            if (!otherNodeType || !relation) return [k, undefined];

            return [
              relationName,
              this.optimisticRawObjPool[otherNodeType]?.[
                (otherNode as GraphNode).id
              ],
            ];
          })
        ),
        ...Object.fromEntries(
          Array.from(node.referencedBy.entries()).map(([k, v]) => {
            const isMany = v instanceof Set;

            const otherNode = isMany
              ? Array.from(v.values()).flatMap((v) => {
                  const node = this.optimisticObjGraph.getNode(v);

                  return node ? [node] : [];
                })
              : this.optimisticObjGraph.getNode(v);

            if (!otherNode) return [k, undefined];

            const [relationName, relation] =
              Object.entries(this.schema[resourceType].relations).find(
                (r) => r[1].relationalColumn === k || r[1].foreignColumn === k
              ) ?? [];

            const otherNodeType = relation?.entity.name;

            if (!otherNodeType || !relation)
              return [k, isMany ? [] : undefined];

            return [
              relationName,
              isMany
                ? {
                    value: (otherNode as GraphNode[]).map(
                      (v) => this.optimisticRawObjPool[otherNodeType]?.[v.id]
                    ),
                  }
                : this.optimisticRawObjPool[otherNodeType]?.[
                    (otherNode as GraphNode).id
                  ],
            ];
          })
        ),
      },
    } as MaterializedLiveType<LiveObjectAny>;
  }
}

export type ObservableClientState<T> = {
  [K in keyof T]: ObservableClientState<T[K]>;
} & {
  get: () => T;
  subscribe: (callback: (value: T) => void) => () => void;
  subscribeToRemote: () => () => void;
};

export type Client<TRouter extends AnyRouter> = {
  client: {
    ws: WebSocketClient;
    subscribeToRemote: (resourceType?: string[]) => () => void;
  };
  store: ObservableClientState<ClientState<TRouter>> & {
    [K in keyof TRouter["routes"]]: {
      // TODO handle these as custom mutations
      insert: (
        input: Simplify<
          LiveObjectMutationInput<TRouter["routes"][K]["_resourceSchema"]>
        >
      ) => void;
      update: (
        id: string,
        value: Omit<
          Simplify<
            LiveObjectMutationInput<TRouter["routes"][K]["_resourceSchema"]>
          >,
          "id"
        >
      ) => void;
    };
  } & {
    [K in keyof TRouter["routes"]]: {
      [K2 in keyof TRouter["routes"][K]["customMutations"]]: (
        input: z.infer<
          TRouter["routes"][K]["customMutations"][K2]["inputValidator"]
        >
      ) => Promisify<
        ReturnType<TRouter["routes"][K]["customMutations"][K2]["handler"]>
      >;
    };
  };
};

export type ClientOptions = {
  url: string;
  schema: Schema<any>;
  credentials?: Generatable<Awaitable<Record<string, string>>>;
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): Client<TRouter> => {
  const ogClient = new InnerClient(opts);

  return {
    client: {
      ws: ogClient.ws,
      subscribeToRemote: (resourceType?: string[]) => {
        const removeListeners: (() => void)[] = [];

        for (const rt of resourceType ?? Object.keys(ogClient.schema)) {
          removeListeners.push(ogClient.subscribeToRemote(rt));
        }

        return () => {
          console.log("Removing listeners", removeListeners);
          removeListeners.forEach((remove) => remove());
        };
      },
    },
    store: createObservable(() => {}, {
      apply: (_, path, argumentsList) => {
        const selector = path.slice(0, -1);
        const lastSegment = path[path.length - 1];

        if (lastSegment === "get") return ogClient.get(selector);

        if (lastSegment === "subscribe")
          return ogClient.subscribeToSlice(selector, argumentsList[0]);

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
