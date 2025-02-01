import { nanoid } from "nanoid";
import { z } from "zod";
import { ClientMessage, serverMessageSchema } from "../core/internals";
import { AnyRoute, AnyRouter } from "../server";
import { createObservable } from "./observable";

export * from "./react";

export class LiveStore<TRoute extends AnyRoute> {
  private readonly shapeName: string;
  private readonly _route!: TRoute;
  private state: z.infer<TRoute["shape"]>;
  private ws: WebSocket;
  private listeners: Set<(state: z.infer<TRoute["shape"]>) => void>;

  private _set(newState: z.infer<TRoute["shape"]>) {
    this.state = newState;
    this.listeners.forEach((listener) => listener(newState));
  }

  constructor(
    shapeName: string,
    ws: WebSocket,
    defaultState: z.infer<TRoute["shape"]>
  ) {
    this.shapeName = shapeName;
    this.ws = ws;
    this.state = defaultState;
    this.listeners = new Set();

    this.ws.addEventListener("message", (event) => {
      try {
        const parsedMessage = serverMessageSchema.parse(JSON.parse(event.data));

        if (parsedMessage.type === "MUTATE") {
          const { shape, mutations } = parsedMessage;

          if (shape === this.shapeName) {
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
          shape: this.shapeName,
        } satisfies ClientMessage)
      );
    });
  }

  public get() {
    return this.state;
  }

  public subscribe(listener: (state: z.infer<TRoute["shape"]>) => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
}

export type StoreState<TStore extends LiveStore<AnyRoute>> = ReturnType<
  TStore["get"]
>;

export type Client<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]: {
    createStore: (
      defaultState: z.infer<TRouter["routes"][K]["shape"]>
    ) => LiveStore<TRouter["routes"][K]>;
  };
};

export type ClientOptions = {
  url: string;
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

      return (defaultState: z.infer<TRouter["routes"][typeof id]["shape"]>) => {
        return new LiveStore(id as string, ogClient.ws, defaultState);
      };
    },
  }) as Client<TRouter>;
};
