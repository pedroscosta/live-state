import { nanoid } from "nanoid";
import { z } from "zod";
import { ClientMessage, serverMessageSchema } from "../core/internals";
import { AnyRoute, AnyRouter } from "../server";
import { createObservable } from "./observable";

export class LiveStore<TRoute extends AnyRoute> {
  private readonly shapeName: string;
  private readonly _route!: TRoute;
  private state: z.infer<TRoute["shape"]>;
  private ws: WebSocket;

  private _set(newState: z.infer<TRoute["shape"]>) {
    this.state = newState;
  }

  constructor(
    shapeName: string,
    ws: WebSocket,
    defaultState: z.infer<TRoute["shape"]>
  ) {
    this.shapeName = shapeName;
    this.ws = ws;
    this.state = defaultState;

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
}

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
