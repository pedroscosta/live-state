import { WebsocketRequestHandler } from "express-ws";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter } from ".";
import { ServerMessage } from "../core";
import { clientMessageSchema } from "../core/internals";
import { AnyShape, MaterializedLiveType } from "../schema";

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
  const states: Record<RouteId, MaterializedLiveType<AnyShape>> = {};

  const propagateMutation = (
    shape: string,
    mutation: string,
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
          mutation,
        } satisfies ServerMessage)
      );
    });
  };

  return (ws) => {
    const clientId = nanoid();
    console.log("Client connected:", clientId);

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
        } else if (parsedMessage.type === "MUTATE") {
          // TODO Handle error responses
          const { route, mutations } = parsedMessage;

          if (!router.routes[route]) return;
          if (!mutations.length) return;

          for (const strMutation of mutations) {
            try {
              console.log(`Applying mutation on ${route}`);
              const materializedMutation = router.routes[route].shape.decode(
                strMutation,
                states[route]
              );

              states[route] = materializedMutation;

              propagateMutation(route, strMutation);
            } catch (e) {
              console.error("Error parsing mutation from the client:", e);
            }
          }
        }
      } catch (e) {
        console.error("Error parsing message from the client:", e);
      }
    });

    ws.on("close", () => {
      console.log("Connection closed", clientId);
      connections[clientId]?.close();
      delete connections[clientId];

      Object.entries(subscriptions).forEach(([shape, clients]) => {
        delete clients[clientId];
      });
    });
  };
};
