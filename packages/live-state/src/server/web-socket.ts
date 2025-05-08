import { WebsocketRequestHandler } from "express-ws";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter, ClientId, RequestType, Server } from ".";
import { mergeMutation } from "../core";
import {
  MutationMessage,
  ServerBootstrapMessage,
  ServerRejectMessage,
  clientMessageSchema,
} from "../core/internals";
import { InferIndex, LiveTypeAny, MaterializedLiveType } from "../schema";

export type Subscription = {
  filters?: Record<string, any>;
};

// Types just for better readability
type RouteId = string;
/**
 * @deprecated
 */
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
          const { resource: shape } = parsedMessage;

          if (!subscriptions[shape]) subscriptions[shape] = {};

          subscriptions[shape][clientId] = {};

          console.log("Subscribing to", subscriptions);

          ws.send(
            JSON.stringify({
              type: "BOOTSTRAP",
              resource: shape,
              data: Object.values(states[shape] ?? {}),
            } satisfies ServerBootstrapMessage)
          );
        } else if (parsedMessage.type === "MUTATE") {
          // TODO Handle error responses
          const { resource: route } = parsedMessage;

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
          // if (!router.routes[objectName]) return;
          // ws.send(
          //   JSON.stringify({
          //     type: "BOOTSTRAP",
          //     resource: objectName,
          //     data: Object.values(states[objectName] ?? {}),
          //   } satisfies ServerBootstrapMessage)
          // );
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

export const webSocketAdapter = (server: Server<AnyRouter>) => {
  const connections: Record<ClientId, WebSocket> = {};
  const subscriptions: Record<string, Record<ClientId, Subscription>> = {};

  server.subscribeToMutations((m) => {
    console.log("Mutation propagated:", m);
    Object.entries(subscriptions[m.resource] ?? {}).forEach(
      ([clientId, sub]) => {
        // TODO handle filters
        connections[clientId]?.send(JSON.stringify(m));
      }
    );
  });

  return (ws: WebSocket) => {
    const clientId = nanoid();

    // TODO add middlewares and ability to refuse connection

    connections[clientId] = ws;
    console.log("Client connected:", clientId);

    ws.on("message", async (message) => {
      try {
        console.log("Message received from the client:", message);

        const parsedMessage = clientMessageSchema.parse(
          JSON.parse(message.toString())
        );

        if (parsedMessage.type === "SUBSCRIBE") {
          const { resource: shape } = parsedMessage;

          if (!subscriptions[shape]) subscriptions[shape] = {};

          subscriptions[shape][clientId] = {};

          // TODO send bootstrap
        } else if (parsedMessage.type === "BOOTSTRAP") {
          const { resources: _res } = parsedMessage;

          const resources = _res ?? Object.keys(server.schema);

          console.log("Bootstraping resources:", resources);

          await Promise.all(
            resources.map(async (resourceName) => {
              const result = await server.handleRequest({
                req: {
                  type: "FIND",
                  resourceName,
                },
              });

              if (!result || !result.data) {
                throw new Error("Invalid resource");
              }

              ws.send(
                JSON.stringify({
                  type: "BOOTSTRAP",
                  resource: resourceName,
                  data: Object.values(result.data),
                } satisfies ServerBootstrapMessage)
              );
            })
          );
        } else if (parsedMessage.type === "MUTATE") {
          const { resource, mutationType } = parsedMessage;
          console.log("Received mutation from client:", parsedMessage);
          try {
            const result = await server.handleRequest({
              req: {
                type: mutationType.toUpperCase() as RequestType,
                resourceName: resource,
                payload: parsedMessage.payload,
                messageId: parsedMessage._id,
                resourceId: parsedMessage.resourceId,
              },
            });

            if (
              !result ||
              !result.acceptedValues ||
              Object.keys(result.acceptedValues).length === 0
            ) {
              ws.send(
                JSON.stringify({
                  _id: parsedMessage._id,
                  type: "REJECT",
                  resource,
                } satisfies ServerRejectMessage)
              );
            }
          } catch (e) {
            console.error("Error parsing mutation from the client:", e);
          }
        }
      } catch (e) {
        // TODO send error to client
        console.error("Error handling message from the client:", e);
      }
    });

    ws.on("close", () => {
      console.log("Connection closed", clientId);
      delete connections[clientId];
    });
  };
};
