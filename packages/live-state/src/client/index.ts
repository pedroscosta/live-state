import { z } from "zod";
import { AnyRoute, AnyRouter, createRouter, route } from "../server";
import { number } from "../shape";
import { createObservable } from "./observable";

export class LiveStore<TRoute extends AnyRoute> {
  private readonly _route!: TRoute;
  private state: z.infer<TRoute["shape"]>;
  private ws: WebSocket;

  constructor(ws: WebSocket, defaultState: z.infer<TRoute["shape"]>) {
    this.ws = ws;
    this.state = defaultState;
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
        return new LiveStore(ogClient.ws, defaultState);
      };
    },
  }) as Client<TRouter>;
};

/**
 * ##########################################################################
 * TESTING AREA
 * ##########################################################################
 */

const counter = number();

const test = createRouter({
  counter: route(counter),
});

const testClient = createClient<typeof test>({
  url: "ws://localhost:5001/ws",
});

testClient.counter.createStore({
  value: 0,
  _metadata: { timestamp: new Date().toISOString() },
});
