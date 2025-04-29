import { nanoid } from "nanoid";
import {
  ClientMessage,
  MutationMessage,
  serverMessageSchema,
} from "../core/internals";
import { mergeMutation, mergeMutationReducer } from "../core/state";
import {
  InferIndex,
  InferLiveType,
  inferValue,
  LiveObject,
  LiveObjectInsertMutation,
  LiveObjectUpdateMutation,
  MaterializedLiveType,
  Schema,
} from "../schema";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { createObservable, Observable } from "./observable";
import { Tree } from "./tree";
import { index } from "./utils";
import { WebSocketClient } from "./web-socket";

export * from "./react";

export type ClientRawState<TRouter extends AnyRouter> = Record<
  keyof TRouter["routes"],
  | Record<
      string,
      MaterializedLiveType<TRouter["routes"][keyof TRouter["routes"]]["shape"]>
    >
  | undefined
>;

export type ClientState<TRouter extends AnyRouter> = Record<
  keyof TRouter["routes"],
  | Record<
      string,
      InferLiveType<TRouter["routes"][keyof TRouter["routes"]]["shape"]>
    >
  | undefined
>;

type MutationInputMap = {
  insert: LiveObjectInsertMutation<LiveObject<any>>;
  update: LiveObjectUpdateMutation<LiveObject<any>>;
};

class InnerClient<TRouter extends AnyRouter, TSchema extends Schema> {
  public readonly _router!: TRouter;

  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly schema: TSchema;

  state: ClientRawState<TRouter> = {} as ClientRawState<TRouter>;
  mutationStack: Record<keyof TRouter["routes"], MutationMessage[]> =
    {} as Record<keyof TRouter["routes"], MutationMessage[]>;
  optimisticState: ClientState<TRouter> = {} as ClientState<TRouter>;

  private listeners: Tree<(state: typeof this.state) => void> = new Tree();
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

        Object.values(this.mutationStack).forEach((mutations) => {
          mutations.forEach((m) => this.sendWsMessage(m));
        });
      }
    });
  }

  public get() {
    return this.optimisticState;
  }

  public getRaw() {
    return this.state;
  }

  private updateOptimisticState(objectName: keyof TRouter["routes"]) {
    const optimisticState = (this.mutationStack[objectName] ?? []).reduce(
      mergeMutationReducer<TSchema["entities"][number]>(
        this.schema.entities.find((e) => e.name === objectName)!
      ),
      this.state[objectName] ?? {}
    );

    this.optimisticState[objectName] = Object.fromEntries(
      Object.entries(optimisticState).map(([key, value]) => [
        key,
        inferValue(value),
      ])
    );

    this.notifyStateSubscribers([objectName.toString()]);
  }

  private addOptimisticMutation(
    objectName: keyof TRouter["routes"],
    mutation: MutationMessage
  ) {
    console.log("Adding optimistic mutation:", mutation);

    this.mutationStack[objectName] = [
      ...(this.mutationStack[objectName] ?? []),
      mutation,
    ];

    this.updateOptimisticState(objectName);
  }

  private removeOptimisticMutation(
    objectName: keyof TRouter["routes"],
    mutationId: MutationMessage["_id"]
  ) {
    console.log("Removing optimistic mutation:", mutationId);

    this.mutationStack[objectName] = this.mutationStack[objectName]?.filter(
      (m) => m._id !== mutationId
    );

    this.updateOptimisticState(objectName);
  }

  private _set(
    objectName: keyof TRouter["routes"],
    state: Record<
      InferIndex<TRouter["routes"][keyof TRouter["routes"]]["shape"]>,
      MaterializedLiveType<TRouter["routes"][keyof TRouter["routes"]]["shape"]>
    >,
    mutationToRemove?: MutationMessage["_id"]
  ) {
    this.state[objectName] = state;

    if (mutationToRemove) {
      this.removeOptimisticMutation(objectName, mutationToRemove);
    } else {
      this.updateOptimisticState(objectName);
    }
  }

  public handleServerMessage(message: MessageEvent["data"]) {
    try {
      console.log("Message received from the server:", message);
      const parsedMessage = serverMessageSchema.parse(JSON.parse(message));

      if (parsedMessage.type === "MUTATE") {
        const { resource } = parsedMessage;

        const routeState = this.state[resource] ?? {};

        try {
          this._set(
            resource,
            mergeMutation<TSchema["entities"][number]>(
              this.schema.entities.find((e) => e.name === resource)!,
              routeState,
              parsedMessage
            ),
            parsedMessage._id
          );
        } catch (e) {
          console.error("Error parsing mutation from the server:", e);
        }
      } else if (parsedMessage.type === "BOOTSTRAP") {
        const { resource, data } = parsedMessage;

        this._set(
          resource,
          Object.fromEntries(data.map((d) => [d.value?.id?.value, d]))
        );
      }
    } catch (e) {
      console.error("Error parsing message from the server:", e);
    }
  }

  public subscribeToRemote(routeName: string) {
    this.routeSubscriptions[routeName] =
      (this.routeSubscriptions[routeName] ?? 0) + 1;
    console.log("Subscribing to remote");

    this.sendWsMessage({
      _id: nanoid(),
      type: "SUBSCRIBE",
      resource: routeName,
    });

    return () => {
      console.log("Unsubscribing from remote", routeName);
      this.routeSubscriptions[routeName] -= 1;

      if (this.routeSubscriptions[routeName] === 0) {
        // TODO add unsubscribe message
      }
    };
  }

  public subscribeToSlice(
    path: string[],
    listener: (state: typeof this.state) => void
  ) {
    this.listeners.add(path, listener);

    return () => {
      this.listeners.remove(path, listener);
    };
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
      payload: this.schema.entities
        .find((e) => e.name === routeName)!
        .encode(mutationType, input, new Date().toISOString()),
      where: (input as LiveObjectUpdateMutation<any>).where,
    };

    this.addOptimisticMutation(routeName, mutationMessage);

    this.sendWsMessage(mutationMessage);
  }

  private sendWsMessage(message: ClientMessage) {
    if (this.ws && this.ws.connected()) this.ws.send(JSON.stringify(message));
  }

  private notifyStateSubscribers(path: string[]) {
    this.listeners
      .getAllUnder(path)
      ?.forEach((listener) => listener(this.state));
  }
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
    };
  };
};

export type ClientOptions = {
  url: string;
  schema: Schema;
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): Client<TRouter> => {
  const ogClient = new InnerClient<TRouter, Schema>(opts);

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

          if (lastSegment === "get")
            return () => index(ogClient.get(), selector);
          if (lastSegment === "subscribe")
            return (callback: (value: any) => void) => {
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
                ogClient.mutate("insert", selector[0], { value: input });
              };
          }
          // if (base === "subscribeToState")
          //   return ogClient.subscribeToState.bind(ogClient);
          // if (base === "subscribeToRoute")
          //   return ogClient.subscribeToRoute.bind(ogClient);

          // if (path.length > 3 || base !== "routes")
          //   throw new SyntaxError(
          //     `Trying to access a property on the client that does't exist ${path.join(".")}`
          //   );

          // if (op === "insert")
          //   return (
          //     value: LiveObjectInsertMutation<
          //       TRouter["routes"][string]["shape"]
          //     >["value"]
          //   ) => {
          //     ogClient.mutate("insert", routeName, {
          //       value,
          //     });
          //   };

          // if (op === "update")
          //   return (
          //     input: LiveObjectUpdateMutation<TRouter["routes"][string]["shape"]>
          //   ) => {
          //     ogClient.mutate("update", routeName, input);
          //   };
        },
      }
    ) as unknown as Client<TRouter>["store"],
  };
};

// TODO REMOVE

// const obs = createObservable({} as any, {
//   get: (target, path) => {
//     console.log("Target:", target);
//     console.log("Path:", path);
//   },
// });

// console.log("obs.issues", obs.issues);
// console.log("obs.issues[0]", obs.issues[0]);
// console.log("obs.issues[0].name", obs.issues[0].name.get());
