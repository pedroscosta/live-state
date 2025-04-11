import { WebsocketRequestHandler } from "express-ws";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter } from ".";
import { mergeMutation } from "../core";
import {
  clientMessageSchema,
  MutationMessage,
  ServerBootstrapMessage,
} from "../core/internals";
import { InferIndex, LiveTypeAny, MaterializedLiveType } from "../schema";

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
  const states: Record<
    RouteId,
    Record<InferIndex<LiveTypeAny>, MaterializedLiveType<LiveTypeAny>>
  > = {};

  const propagateMutation = (
    shape: string,
    mutation: MutationMessage,
    ignore?: string
  ) => {
    if (!subscriptions[shape]) return;

    Object.entries(subscriptions[shape]).forEach(([id, sub]) => {
      if (ignore && id === ignore) return;
      console.log(id, sub);

      connections[id]?.send(JSON.stringify(mutation));
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

          ws.send(
            JSON.stringify({
              type: "BOOTSTRAP",
              objectName: shape,
              data: Object.values(states[shape] ?? {}),
            } satisfies ServerBootstrapMessage)
          );
        } else if (parsedMessage.type === "MUTATE") {
          // TODO Handle error responses
          const { route } = parsedMessage;

          if (!router.routes[route]) return;

          try {
            console.log(`Applying mutation on ${route}`);

            states[route] = mergeMutation(
              router.routes[route].shape,
              states[route] ?? {},
              parsedMessage
            );

            propagateMutation(route, parsedMessage);
          } catch (e) {
            console.error("Error parsing mutation from the client:", e);
          }
        } else if (parsedMessage.type === "BOOTSTRAP") {
          const { objectName } = parsedMessage;

          if (!router.routes[objectName]) return;

          ws.send(
            JSON.stringify({
              type: "BOOTSTRAP",
              objectName,
              data: Object.values(states[objectName] ?? {}),
            } satisfies ServerBootstrapMessage)
          );
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
