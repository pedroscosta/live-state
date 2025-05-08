import { nanoid } from "nanoid";
import { ClientMessage, MutationMessage } from "../core/internals";
import {
  InferIndex,
  InferLiveObject,
  inferValue,
  LiveObjectAny,
  LiveObjectInsertMutation,
  LiveObjectUpdateMutation,
  LiveString,
  MaterializedLiveObject,
  MaterializedLiveType,
  MutationUnion,
  Schema,
} from "../schema";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { GraphNode, ObjectGraph } from "./obj-graph";
import { createObservable, Observable } from "./observable";
import { WebSocketClient } from "./web-socket";

export * from "./react";

export type RawObjPool<TRouter extends AnyRouter> = Record<
  keyof TRouter["routes"],
  | Record<
      string,
      MaterializedLiveObject<
        TRouter["routes"][keyof TRouter["routes"]]["shape"]
      >
    >
  | undefined
>;

export type ClientState<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]:
    | Record<
        InferIndex<TRouter["routes"][K]["shape"]>,
        InferLiveObject<TRouter["routes"][K]["shape"]>
      >
    | undefined;
};

type MutationInputMap = {
  insert: LiveObjectInsertMutation<LiveObjectAny>;
  update: LiveObjectUpdateMutation<LiveObjectAny>;
};

class InnerClient<TRouter extends AnyRouter, TSchema extends Schema<any>> {
  public readonly _router!: TRouter;

  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly schema: TSchema;

  private rawObjPool: RawObjPool<TRouter> = {} as RawObjPool<TRouter>;
  private optimisticMutationStack: Record<
    keyof TRouter["routes"],
    MutationMessage[]
  > = {} as Record<keyof TRouter["routes"], MutationMessage[]>;
  private optimisticObjGraph: ObjectGraph = new ObjectGraph();
  private optimisticRawObjPool: RawObjPool<TRouter> = {} as RawObjPool<TRouter>;

  private resourceTypeSubscriptions: Record<string, Set<() => void>> = {};

  // This is subscriptions count for each route
  private routeSubscriptions: Record<string, number> = {};

  public constructor(opts: ClientOptions) {
    this.url = opts.url;
    this.schema = opts.schema as TSchema;
    this.ws = new WebSocketClient({
      url: opts.url,
      autoConnect: true,
      autoReconnect: true,
      reconnectTimeout: 5000,
    });

    this.ws.addEventListener("message", (e) => {
      this.handleServerMessage(e.data);
    });

    this.ws.addEventListener("connectionChange", (e) => {
      if (e.open) {
        this.sendWsMessage({
          _id: nanoid(),
          type: "BOOTSTRAP",
        });

        Object.entries(this.routeSubscriptions).forEach(
          ([routeName, count]) => {
            if (count > 0) {
              this.sendWsMessage({
                _id: nanoid(),
                type: "SUBSCRIBE",
                resource: routeName,
              });
            }
          }
        );

        Object.values(this.optimisticMutationStack).forEach((mutations) => {
          mutations.forEach((m) => this.sendWsMessage(m));
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

    return inferValue(this.getFullObject(path[0], path[1]) as any);
  }

  public handleServerMessage(message: MessageEvent["data"]) {
    // try {
    //   console.log("Message received from the server:", message);
    //   const parsedMessage = serverMessageSchema.parse(JSON.parse(message));
    //   if (parsedMessage.type === "MUTATE") {
    //     const { resource } = parsedMessage;
    //     const routeState = this.state[resource] ?? {};
    //     try {
    //       this._set(
    //         resource,
    //         mergeMutation<TSchema[string]>(
    //           this.schema[resource as string] as TSchema[string],
    //           routeState,
    //           parsedMessage
    //         ),
    //         parsedMessage._id
    //       );
    //     } catch (e) {
    //       console.error("Error parsing mutation from the server:", e);
    //     }
    //   } else if (parsedMessage.type === "BOOTSTRAP") {
    //     const { resource, data } = parsedMessage;
    //     this._set(
    //       resource,
    //       Object.fromEntries(data.map((d) => [d.value?.id?.value, d]))
    //     );
    //   } else if (parsedMessage.type === "REJECT") {
    //     this.removeOptimisticMutation(
    //       parsedMessage.resource,
    //       parsedMessage._id,
    //       true
    //     );
    //   }
    // } catch (e) {
    //   console.error("Error parsing message from the server:", e);
    // }
  }

  public subscribeToRemote(routeName: string) {
    this.routeSubscriptions[routeName] =
      (this.routeSubscriptions[routeName] ?? 0) + 1;

    this.sendWsMessage({
      _id: nanoid(),
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

  public mutate<TMutation extends keyof MutationInputMap>(
    mutationType: TMutation,
    routeName: keyof TRouter["routes"],
    input: MutationInputMap[TMutation]
  ) {
    const mutationMessage: MutationMessage = {
      _id: nanoid(),
      type: "MUTATE",
      resource: routeName as string,
      mutationType,
      payload: this.schema[routeName].encodeMutation(
        mutationType,
        input as MutationUnion<TSchema[string]>,
        new Date().toISOString()
      ),
      resourceId: (input as LiveObjectUpdateMutation<any>).value.id,
    };

    this.addMutation(routeName, mutationMessage, true);

    this.sendWsMessage(mutationMessage);
  }

  private sendWsMessage(message: ClientMessage) {
    if (this.ws && this.ws.connected()) this.ws.send(JSON.stringify(message));
  }

  private addMutation(
    routeName: keyof TRouter["routes"],
    mutation: MutationMessage,
    optimistic: boolean = false
  ) {
    const schema = this.schema[routeName];

    if (!schema) throw new Error("Schema not found");

    if (optimistic) {
      if (!this.optimisticMutationStack[routeName])
        this.optimisticMutationStack[routeName] = [];

      this.optimisticMutationStack[routeName].push(mutation);
    }

    if (!this.optimisticObjGraph.getNode(mutation.resourceId))
      this.optimisticObjGraph.createNode(
        mutation.resourceId,
        routeName as string,
        Object.values(schema.relations).flatMap((k) =>
          k.type === "many" ? [k.foreignColumn] : []
        )
      );

    const prevValue =
      this.optimisticRawObjPool[routeName]?.[mutation.resourceId] ??
      this.rawObjPool[routeName]?.[mutation.resourceId];

    if (!optimistic) {
      this.rawObjPool[routeName] ??= {};
      this.rawObjPool[routeName][mutation.resourceId] = this.schema[
        routeName
      ].mergeMutation(
        mutation.mutationType,
        mutation.payload,
        this.rawObjPool[routeName][mutation.resourceId]
      )[0] as MaterializedLiveObject<
        TRouter["routes"][keyof TRouter["routes"]]["shape"]
      >;
    }

    this.optimisticRawObjPool[routeName] ??= {};

    this.optimisticRawObjPool[routeName][mutation.resourceId] =
      this.optimisticMutationStack[routeName].reduce((acc, mutation) => {
        if (mutation.resourceId !== mutation.resourceId) return acc;

        return this.schema[routeName].mergeMutation(
          mutation.mutationType,
          mutation.payload,
          acc
        )[0] as MaterializedLiveObject<
          TRouter["routes"][keyof TRouter["routes"]]["shape"]
        >;
      }, prevValue) as MaterializedLiveObject<
        TRouter["routes"][keyof TRouter["routes"]]["shape"]
      >;

    this.resourceTypeSubscriptions[routeName as string]?.forEach((listener) =>
      listener()
    );

    if (Object.keys(schema.relations).length > 0) {
      const schemaRelationalFields = Object.fromEntries(
        Object.entries(schema.relations).flatMap(([k, r]) =>
          r.type === "one" ? [[r.relationalColumn as string, k]] : []
        )
      );

      Object.entries(mutation.payload).forEach(([k, v]) => {
        if (!schemaRelationalFields[k]) return;

        const [, acceptedValue] = schema.relations[
          schemaRelationalFields[k]
        ].mergeMutation(
          "set",
          v,
          prevValue as MaterializedLiveType<LiveString> | undefined
        );

        if (!acceptedValue) return;

        // TODO Handle if objects arrive out of order by creating the other node if it doesn't exist

        this.optimisticObjGraph.createLink(
          mutation.resourceId,
          acceptedValue.split(";")[0],
          k
        );
      });
    }
  }

  private getFullObject(
    resourceType: string,
    id: string
  ): MaterializedLiveObject<LiveObjectAny> | undefined {
    const node = this.optimisticObjGraph.getNode(id);

    if (!node) return;

    const obj = this.optimisticRawObjPool[resourceType]?.[id];

    if (!obj) return;

    return {
      value: {
        ...obj.value,
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
              {
                value: isMany
                  ? (otherNode as GraphNode[]).map(
                      (v) => this.optimisticRawObjPool[otherNodeType]?.[v.id]
                    )
                  : this.optimisticRawObjPool[otherNodeType]?.[
                      (otherNode as GraphNode).id
                    ],
              },
            ];
          })
        ),
      },
    };
  }

  // private notifyStateSubscribers(path: string[]) {
  //   this.listeners
  //     .getAllAbove(path)
  //     ?.forEach((listener) => listener(this.state));
  // }
}

export type Client<TRouter extends AnyRouter> = {
  /**
   * @internal
   */
  _router: TRouter;
  client: {
    ws: WebSocketClient;
  };
  store: Observable<ClientState<TRouter>> & {
    [K in keyof TRouter["routes"]]: {
      insert: (
        input: Simplify<
          LiveObjectInsertMutation<TRouter["routes"][K]["shape"]>
        >["value"]
      ) => void;
      update: (
        id: string,
        value: Simplify<
          LiveObjectUpdateMutation<TRouter["routes"][K]["shape"]>
        >["value"]
      ) => void;
    };
  };
};

export type ClientOptions = {
  url: string;
  schema: Schema<any>;
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): Client<TRouter> => {
  const ogClient = new InnerClient<TRouter, Schema<any>>(opts);

  return {
    _router: ogClient._router,
    client: {
      ws: ogClient.ws,
    },
    store: createObservable(
      {},
      {
        get: (_, path) => {
          const selector = path.slice(0, -1);
          const lastSegment = path[path.length - 1];

          if (lastSegment === "get") {
            return () => ogClient.get(selector);
          }
          if (lastSegment === "subscribe")
            return (callback: () => void) => {
              const remove = ogClient.subscribeToSlice(selector, callback);
              return remove;
            };
          if (lastSegment === "subscribeToRemote")
            return ogClient.subscribeToRemote.bind(ogClient, selector[0]);

          if (selector.length === 1) {
            if (lastSegment === "insert")
              return (
                input: Simplify<
                  LiveObjectInsertMutation<TRouter["routes"][string]["shape"]>
                >["value"]
              ) => {
                ogClient.mutate("insert", selector[0], {
                  value: input,
                } as LiveObjectInsertMutation<
                  TRouter["routes"][string]["shape"]
                >);
              };
            if (lastSegment === "update")
              return (
                id: string,
                input: Simplify<
                  LiveObjectUpdateMutation<TRouter["routes"][string]["shape"]>
                >["value"]
              ) => {
                ogClient.mutate("update", selector[0], { value: input, id });
              };
          }
        },
      }
    ) as unknown as Client<TRouter>["store"],
  };
};
