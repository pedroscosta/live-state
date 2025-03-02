import { WebsocketRequestHandler } from "express-ws";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter } from ".";
import { ServerMessage } from "../core";
import { clientMessageSchema } from "../core/internals";
import { AnyShape, MaterializedShape } from "../schema";

let counter = 0;

export type Subscription = {
  __subscribed: true;
  filters?: Record<string, any>;
};

// Types just for better readability
type RouteId = string;
type ClientId = string;

export const createWSServer: <T extends AnyRouter>(
  router: T
) => WebsocketRequestHandler = (router) => {
  const connections: Record<ClientId, WebSocket> = {};
  const subscriptions: Record<RouteId, Record<ClientId, Subscription>> = {};
  const states: Record<RouteId, MaterializedShape<AnyShape>> = {};

  const propagateMutations = (
    shape: string,
    mutations: any,
    ignore?: string
  ) => {
    if (!subscriptions[shape]) return;

    Object.entries(subscriptions[shape]).forEach(([id, sub]) => {
      if (ignore && id === ignore) return;
      console.log(id, sub);

      connections[id]?.send(
        JSON.stringify({
          type: "MUTATE",
          shape,
          mutations,
        } satisfies ServerMessage)
      );
    });
  };

  return (ws) => {
    const clientId = nanoid();

    connections[clientId] = ws;

    ws.on("message", (message) => {
      console.log("Message received from the client:", message);
      try {
        const parsedMessage = clientMessageSchema.parse(
          JSON.parse(message.toString())
        );

        if (parsedMessage.type === "SUBSCRIBE") {
          const { shape } = parsedMessage;

          if (!subscriptions[shape]) subscriptions[shape] = {};

          subscriptions[shape][clientId] = {
            __subscribed: true,
          };

          console.log("Subscribing to", subscriptions);
        }
        // else if (parsedMessage.type === "MUTATE") {
        //   // TODO Handle error responses
        //   const { route, mutations } = parsedMessage;

        //   if (!router.routes[route]) return;
        //   if (!mutations.length) return;

        //   // TODO Handle batch mutations
        //   // TODO Make the encoding better (; in the parts would break this)

        //   const [mutationName] = mutations[0].split(";");

        //   if (!mutationName || !router.routes[route].mutations[mutationName])
        //     return;

        //   const materializedShape = router.routes[route].shape.decode(
        //     mutations[0],
        //     states[route]
        //   );

        //   console.log("Mutating", materializedShape);

        //   states[route] = materializedShape;

        //   // TODO: Broadcast mutations to all subscribers
        // }
      } catch (e) {
        console.error("Error parsing message from the client:", e);
      }
    });

    ws.on("close", () => {
      console.log("Connection closed", clientId);
      connections[clientId]?.close();
      delete connections[clientId];
    });
  };
};
