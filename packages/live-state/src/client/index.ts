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
import { AnyRoute, AnyRouter } from "../server";
import { createObservable } from "./observable";

export * from "./react";

export class LiveStore<TRoute extends AnyRoute> {
  public _route!: TRoute;
  private readonly routeName: string;
  private readonly schema: TRoute["shape"];
  private state: Record<
    InferIndex<TRoute["shape"]>,
    MaterializedLiveType<TRoute["shape"]>
  > = {};
  private inferredState: InferLiveType<TRoute["shape"]>[] = [];
  private ws: WebSocket;
  private listeners: Set<(state: typeof this.state) => void>;

  private _set(newState: typeof this.state) {
    this.state = newState;
    this.inferredState = Object.values(newState).map(inferValue);
    this.listeners.forEach((listener) => listener(newState));
  }

  constructor(routeName: string, schema: TRoute["shape"], ws: WebSocket) {
    this.routeName = routeName;
    this.schema = schema;
    this.ws = ws;
    this.listeners = new Set();

    this.ws.addEventListener("message", (event) => {
      try {
        const parsedMessage = serverMessageSchema.parse(JSON.parse(event.data));

        if (parsedMessage.type === "MUTATE") {
          const { shape, mutation } = parsedMessage;

          if (shape === this.routeName) {
            try {
              const { type, values, where } = objectMutationSchema.parse(
                JSON.parse(mutation)
              );

              if (type === "insert") {
                const newRecord = this.schema.decode(
                  type as MutationType,
                  values
                ) as MaterializedLiveType<TRoute["shape"]>;

                this._set({
                  ...this.state,
                  [(newRecord.value as any).id.value]: newRecord,
                });
              } else if (type === "update") {
                const record = this.state[where?.id];

                if (!record) return;

                const updatedRecord = this.schema.decode(
                  type as MutationType,
                  values,
                  record
                ) as MaterializedLiveType<TRoute["shape"]>;

                this._set({
                  ...this.state,
                  [(updatedRecord.value as any).id.value]: updatedRecord,
                });
              }
            } catch (e) {
              console.error("Error parsing mutation from the server:", e);
            }
          }
        }

        console.log("Message received from the server:", parsedMessage);
      } catch (e) {
        console.error("Error parsing message from the server:", e);
      }
    });

    this.ws.addEventListener("open", (event) => {
      console.log("WebSocket connection opened");

      this.ws.send(
        JSON.stringify({
          _id: nanoid(),
          type: "SUBSCRIBE",
          shape: this.routeName,
        } satisfies ClientMessage)
      );
    });
  }

  public getRaw() {
    return this.state;
  }

  public get() {
    return this.inferredState;
  }

  public subscribe(listener: (state: typeof this.state) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  // public mutate<TMutName extends keyof TRoute["mutations"]>(
  //   mutation: TMutName,
  //   input: InferShape<TRoute["mutations"][TMutName]["_input"]>
  // ) {
  //   // TODO: Add optimistic updates
  //   this.ws.send(
  //     JSON.stringify({
  //       type: "MUTATE",
  //       _id: nanoid(),
  //       route: this.routeName,
  //       mutations: [
  //         this._route.shape.encode(
  //           mutation as string,
  //           input,
  //           new Date().toISOString()
  //         ),
  //       ],
  //     } satisfies ClientMessage)
  //   );
  // }
}

export type StoreState<TStore extends LiveStore<AnyRoute>> = InferLiveType<
  TStore["_route"]["shape"]
>[];

export type Client<TRouter extends AnyRouter> = {
  ws: WebSocket;
} & {
  [K in keyof TRouter["routes"]]: {
    createStore: () => LiveStore<TRouter["routes"][K]>;
    insert: (state: InferLiveType<TRouter["routes"][K]["shape"]>) => void;
    update: (opts: {
      value: Partial<InferLiveType<TRouter["routes"][K]["shape"]>>;
      where: InferWhereClause<TRouter["routes"][K]["shape"]>;
    }) => void;
  };
};

export type ClientOptions = {
  url: string;
  schema: Record<string, LiveObject<any>>;
};

const createUntypedClient = (opts: ClientOptions) => {
  const ws = new WebSocket(opts.url);

  return { ...opts, ws };
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): Client<TRouter> => {
  const ogClient = createUntypedClient(opts);

  return createObservable(ogClient, {
    get: (_, path) => {
      if (path.length < 2) {
        if (path[0] === "ws") return ogClient.ws;

        return;
      }
      if (path.length > 2)
        throw new SyntaxError(
          "Trying to access a property on the client that does't exist"
        );

      const [_id, op] = path;
      const routeId = _id as keyof TRouter["routes"];

      if (op === "createStore") {
        return () => {
          return new LiveStore<TRouter["routes"][typeof routeId]>(
            routeId as string,
            ogClient.schema[routeId as string],
            ogClient.ws
          );
        };
      } else if (op === "insert") {
        return (
          value: InferLiveType<TRouter["routes"][typeof routeId]["shape"]>
        ) => {
          ogClient.ws.send(
            JSON.stringify({
              _id: nanoid(),
              type: "MUTATE",
              route: routeId as string,
              mutations: [
                ogClient.schema[routeId as string].encode(
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
          value: InferLiveType<TRouter["routes"][typeof routeId]["shape"]>;
          where: InferWhereClause<TRouter["routes"][typeof routeId]["shape"]>;
        }) => {
          ogClient.ws.send(
            JSON.stringify({
              _id: nanoid(),
              type: "MUTATE",
              route: routeId as string,
              mutations: [
                ogClient.schema[routeId as string].encode(
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
  }) as Client<TRouter>;
};
