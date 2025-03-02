import { nanoid } from "nanoid";
import { ClientMessage, serverMessageSchema } from "../core/internals";
import { InferShape, LiveTable, number, table } from "../schema";
import { AnyRoute, AnyRouter, routeFactory, router } from "../server";
import { createObservable } from "./observable";

export * from "./react";

export class LiveStore<TRoute extends AnyRoute> {
  private readonly routeName: string;
  private readonly _route!: TRoute;
  private state?: InferShape<TRoute["shape"]>;
  private ws: WebSocket;
  private listeners: Set<(state: InferShape<TRoute["shape"]>) => void>;

  private _set(newState: InferShape<TRoute["shape"]>) {
    this.state = newState;
    this.listeners.forEach((listener) => listener(newState));
  }

  constructor(routeName: string, ws: WebSocket) {
    this.routeName = routeName;
    this.ws = ws;
    this.listeners = new Set();

    this.ws.addEventListener("message", (event) => {
      try {
        const parsedMessage = serverMessageSchema.parse(JSON.parse(event.data));

        if (parsedMessage.type === "MUTATE") {
          const { shape, mutations } = parsedMessage;

          if (shape === this.routeName) {
            // TODO: Merge mutations into state
            this._set(mutations[0]);
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

  public get() {
    return this.state;
  }

  public subscribe(listener: (state: InferShape<TRoute["shape"]>) => void) {
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

export type StoreState<TStore extends LiveStore<AnyRoute>> = ReturnType<
  TStore["get"]
>;

export type Client<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]: {
    createStore: () => LiveStore<TRouter["routes"][K]>;
  };
};

export type ClientOptions = {
  url: string;
  schema: Record<string, LiveTable<any>>;
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
    get: (obj, path) => {
      if (path.length < 2) return;
      if (path.length > 2 || path[1] !== "createStore")
        throw new SyntaxError(
          "Trying to access a property on the client that does't exist"
        );

      const [_id, op] = path;

      const id = _id as keyof TRouter["routes"];

      return () => {
        return new LiveStore<TRouter["routes"][typeof id]>(
          id as string,
          ogClient.ws
        );
      };
    },
  }) as Client<TRouter>;
};

////////////////////////////////////////////////////////////////////////////////
// TESTING AREA
////////////////////////////////////////////////////////////////////////////////

const counters = table({
  counter: number(),
});

const publicRoute = routeFactory();

const test = router({
  routes: {
    counters: publicRoute(counters),
  },
});

type TestRouter = typeof test;

const testClient = createClient<TestRouter>({
  url: "ws://localhost:5001/ws",
  schema: {
    counters,
  },
});

const store = testClient.counters.createStore();
