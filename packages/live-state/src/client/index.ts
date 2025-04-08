import { nanoid } from "nanoid";
import {
  ClientMessage,
  objectMutationSchema,
  serverMessageSchema,
} from "../core/internals";
import {
  InferIndex,
  InferLiveType,
  inferValue,
  InferWhereClause,
  LiveObject,
  MaterializedLiveType,
  MutationType,
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

class InnerClient<TRouter extends AnyRouter> {
  public readonly _router!: TRouter;

  public readonly url: string;
  public readonly ws: WebSocketClient;
  public readonly schema: Record<string, LiveObject<any>>;

  state: ClientRawState<TRouter> = {} as ClientRawState<TRouter>;
  inferredState: ClientState<TRouter> = {} as ClientState<TRouter>;

  private listeners: Set<(state: typeof this.state) => void> = new Set();
  // This is subscriptions count for each route
  private routeSubscriptions: Record<string, number> = {};

  public constructor(opts: ClientOptions) {
    this.url = opts.url;
    this.schema = opts.schema;
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
      }
    });
  }

  public get() {
    return this.inferredState;
  }

  public getRaw() {
    return this.state;
  }

  private _set(
    objectName: keyof TRouter["routes"],
    state: Record<
      InferIndex<TRouter["routes"][keyof TRouter["routes"]]["shape"]>,
      MaterializedLiveType<TRouter["routes"][keyof TRouter["routes"]]["shape"]>
    >
  ) {
    this.state[objectName] = state;
    this.inferredState[objectName] = Object.fromEntries(
      Object.entries(state).map(([key, value]) => [key, inferValue(value)])
    );
    this.listeners.forEach((listener) => listener(this.state));
  }

  public handleServerMessage(message: MessageEvent["data"]) {
    try {
      const parsedMessage = serverMessageSchema.parse(JSON.parse(message));
      console.log("Message received from the server:", parsedMessage);

      if (parsedMessage.type === "MUTATE") {
        const { shape: routeName, mutation } = parsedMessage;

        try {
          // TODO Remove this unnecessary encoding/decoding
          const { type, values, where } = objectMutationSchema.parse(
            JSON.parse(mutation)
          );

          if (type === "insert") {
            const newRecord = this.schema[routeName].decode(
              type as MutationType,
              values
            ) as MaterializedLiveType<
              TRouter["routes"][typeof routeName]["shape"]
            >;

            this._set(routeName, {
              ...this.state[routeName],
              [(newRecord.value as any).id.value]: newRecord,
            });
          } else if (type === "update") {
            const record = this.state[routeName]?.[where?.id];

            if (!record) return;

            const updatedRecord = this.schema[routeName].decode(
              type as MutationType,
              values,
              record
            ) as MaterializedLiveType<
              TRouter["routes"][typeof routeName]["shape"]
            >;

            this._set(routeName, {
              ...this.state[routeName],
              [(updatedRecord.value as any).id.value]: updatedRecord,
            });
          }
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

  private sendWsMessage(message: ClientMessage) {
    if (this.ws && this.ws.connected()) this.ws.send(JSON.stringify(message));
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
      insert: (state: InferLiveType<TRouter["routes"][K]["shape"]>) => void;
      update: (opts: {
        value: Partial<InferLiveType<TRouter["routes"][K]["shape"]>>;
        where: InferWhereClause<TRouter["routes"][K]["shape"]>;
      }) => void;
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
  const ogClient = new InnerClient<TRouter>(opts);

  return createObservable(ogClient, {
    get: (_, path) => {
      const [base, _routeName, op] = path;

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

      const routeName = _routeName as keyof TRouter["routes"];

      // TODO move mutations to the original client

      if (op === "insert") {
        return (
          value: InferLiveType<TRouter["routes"][typeof routeName]["shape"]>
        ) => {
          ogClient.ws.send(
            JSON.stringify({
              _id: nanoid(),
              type: "MUTATE",
              route: routeName as string,
              mutations: [
                ogClient.schema[routeName as string].encode(
                  "insert",
                  {
                    value,
                  },
                  new Date().toISOString()
                ),
              ],
            } satisfies ClientMessage)
          );
        };
      } else if (op === "update") {
        return (opts: {
          value: InferLiveType<TRouter["routes"][typeof routeName]["shape"]>;
          where: InferWhereClause<TRouter["routes"][typeof routeName]["shape"]>;
        }) => {
          ogClient.ws.send(
            JSON.stringify({
              _id: nanoid(),
              type: "MUTATE",
              route: routeName as string,
              mutations: [
                ogClient.schema[routeName as string].encode(
                  "update",
                  opts,
                  new Date().toISOString()
                ),
              ],
            } satisfies ClientMessage)
          );
        };
      }
    },
  }) as unknown as Client<TRouter>;
};
