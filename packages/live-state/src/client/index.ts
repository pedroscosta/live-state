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
} from "../schema";
import { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { createObservable } from "./observable";
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

class InnerClient<
  TRouter extends AnyRouter,
  TSchema extends Record<string, LiveObject<any>>,
> {
  public readonly _router!: TRouter;

  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly schema: TSchema;

  state: ClientRawState<TRouter> = {} as ClientRawState<TRouter>;
  mutationStack: Record<keyof TRouter["routes"], MutationMessage[]> =
    {} as Record<keyof TRouter["routes"], MutationMessage[]>;
  optimisticState: ClientState<TRouter> = {} as ClientState<TRouter>;

  private listeners: Set<(state: typeof this.state) => void> = new Set();
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
        Object.entries(this.routeSubscriptions).forEach(
          ([routeName, count]) => {
            if (count > 0) {
              this.sendWsMessage({
                _id: nanoid(),
                type: "SUBSCRIBE",
                shape: routeName,
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
      mergeMutationReducer<TSchema[keyof TSchema]>(
        this.schema[objectName as keyof TSchema]
      ),
      this.state[objectName] ?? {}
    );

    this.optimisticState[objectName] = Object.fromEntries(
      Object.entries(optimisticState).map(([key, value]) => [
        key,
        inferValue(value),
      ])
    );

    this.notifyStateSubscribers();
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
      const parsedMessage = serverMessageSchema.parse(JSON.parse(message));
      console.log("Message received from the server:", parsedMessage);

      if (parsedMessage.type === "MUTATE") {
        const { route } = parsedMessage;

        const routeState = this.state[route] ?? {};

        try {
          this._set(
            route,
            mergeMutation<TSchema[keyof TSchema]>(
              this.schema[route as keyof TSchema],
              routeState,
              parsedMessage
            ),
            parsedMessage._id
          );
        } catch (e) {
          console.error("Error parsing mutation from the server:", e);
        }
      } else if (parsedMessage.type === "BOOTSTRAP") {
        const { objectName: routeName, data } = parsedMessage;

        this._set(
          routeName,
          Object.fromEntries(data.map((d) => [d.value?.id?.value, d]))
        );
      }
    } catch (e) {
      console.error("Error parsing message from the server:", e);
    }
  }

  public subscribeToRoute(routeName: string) {
    this.routeSubscriptions[routeName] =
      (this.routeSubscriptions[routeName] ?? 0) + 1;

    this.sendWsMessage({
      _id: nanoid(),
      type: "SUBSCRIBE",
      shape: routeName,
    });

    return () => {
      this.routeSubscriptions[routeName] -= 1;

      if (this.routeSubscriptions[routeName] === 0) {
        // TODO add unsubscribe message
      }
    };
  }

  public subscribeToState(listener: (state: typeof this.state) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
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
      route: routeName as string,
      mutationType,
      payload: this.schema[routeName as string].encode(
        mutationType,
        input,
        new Date().toISOString()
      ),
      where: (input as LiveObjectUpdateMutation<any>).where,
    };

    this.addOptimisticMutation(routeName, mutationMessage);

    this.sendWsMessage(mutationMessage);
  }

  private sendWsMessage(message: ClientMessage) {
    if (this.ws && this.ws.connected()) this.ws.send(JSON.stringify(message));
  }

  private notifyStateSubscribers() {
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export type Client<TRouter extends AnyRouter> = {
  /**
   * @internal
   */
  _router: TRouter;
  ws: WebSocketClient;
  get: () => Simplify<ClientState<TRouter>>;
  getRaw: () => ClientRawState<TRouter>;
  subscribeToRoute: (routeName: string) => () => void;
  subscribeToState: (
    listener: (state: ClientState<TRouter>) => void
  ) => () => void;
  routes: {
    [K in keyof TRouter["routes"]]: {
      insert: (
        state: LiveObjectInsertMutation<TRouter["routes"][K]["shape"]>["value"]
      ) => void;
      update: (
        opts: LiveObjectUpdateMutation<TRouter["routes"][K]["shape"]>
      ) => void;
    };
  };
};

export type ClientOptions = {
  url: string;
  schema: Record<string, LiveObject<any>>;
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): Client<TRouter> => {
  const ogClient = new InnerClient<TRouter, Record<string, LiveObject<any>>>(
    opts
  );

  return createObservable(ogClient, {
    get: (_, path) => {
      const [base, routeName, op] = path;

      if (base === "ws") return ogClient.ws;
      if (base === "get") return ogClient.get.bind(ogClient);
      if (base === "getRaw") return ogClient.getRaw.bind(ogClient);
      if (base === "subscribeToState")
        return ogClient.subscribeToState.bind(ogClient);
      if (base === "subscribeToRoute")
        return ogClient.subscribeToRoute.bind(ogClient);

      if (path.length > 3 || base !== "routes")
        throw new SyntaxError(
          `Trying to access a property on the client that does't exist ${path.join(".")}`
        );

      if (op === "insert")
        return (
          value: LiveObjectInsertMutation<
            TRouter["routes"][string]["shape"]
          >["value"]
        ) => {
          ogClient.mutate("insert", routeName, {
            value,
          });
        };

      if (op === "update")
        return (
          input: LiveObjectUpdateMutation<TRouter["routes"][string]["shape"]>
        ) => {
          ogClient.mutate("update", routeName, input);
        };
    },
  }) as unknown as Client<TRouter>;
};
