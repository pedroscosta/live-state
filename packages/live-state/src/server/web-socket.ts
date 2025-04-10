import { WebsocketRequestHandler } from "express-ws";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter } from ".";
import {
  clientMessageSchema,
  MutationMessage,
  ServerBootstrapMessage,
} from "../core/internals";
import {
  InferIndex,
  LiveTypeAny,
  MaterializedLiveType,
  MutationType,
} from "../schema";

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
          const { route, mutationType, payload, where } = parsedMessage;

          if (!router.routes[route]) return;

          try {
            console.log(`Applying mutation on ${route}`);

            const type = mutationType as MutationType;

            if (type === "insert") {
              const materializedMutation = router.routes[route].shape.decode(
                type,
                payload
              );

              if (!states[route]) states[route] = {};

              states[route][(materializedMutation.value as any).id.value] =
                materializedMutation;
            } else if (type === "update") {
              if (!states[route] || !where || !states[route][where["id"]])
                return;

              const materializedMutation = router.routes[route].shape.decode(
                type,
                payload,
                states[route][where["id"]] // TODO Do a proper query for this
              );

              states[route][(materializedMutation.value as any).id.value] =
                materializedMutation;
            }

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
