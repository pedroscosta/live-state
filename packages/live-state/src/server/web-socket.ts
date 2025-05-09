import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter, ClientId, Server } from ".";
import {
  ServerBootstrapMessage,
  ServerRejectMessage,
  clientMessageSchema,
} from "../core/internals";
import { LiveObjectAny, MaterializedLiveType } from "../schema";

export type Subscription = {
  filters?: Record<string, any>;
};

export const webSocketAdapter = (server: Server<AnyRouter>) => {
  const connections: Record<ClientId, WebSocket> = {};
  const subscriptions: Record<string, Record<ClientId, Subscription>> = {};

  server.subscribeToMutations((m) => {
    console.log("Mutation propagated:", m);
    Object.entries(subscriptions[m.resource] ?? {}).forEach(
      ([clientId, sub]) => {
        // TODO handle subscription filters
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
          const { resource } = parsedMessage;

          if (!subscriptions[resource]) subscriptions[resource] = {};

          subscriptions[resource][clientId] = {};

          // TODO send bootstrap
        } else if (parsedMessage.type === "SYNC") {
          const { resources: _res } = parsedMessage;

          const resources = _res ?? Object.keys(server.schema);

          console.log("Syncing resources:", resources);

          await Promise.all(
            resources.map(async (resourceName) => {
              const result = await server.handleRequest({
                req: {
                  type: "FIND",
                  resourceName,
                  context: {}, // TODO provide context
                },
              });

              if (!result || !result.data) {
                throw new Error("Invalid resource");
              }

              ws.send(
                JSON.stringify({
                  _id: parsedMessage._id,
                  type: "SYNC",
                  resource: resourceName,
                  data: Object.fromEntries(
                    Object.entries(
                      (result.data ?? {}) as Record<
                        string,
                        MaterializedLiveType<LiveObjectAny>
                      >
                    ).map(([id, v]) => [id, v.value])
                  ),
                } satisfies ServerBootstrapMessage)
              );
            })
          );
        } else if (parsedMessage.type === "MUTATE") {
          const { resource } = parsedMessage;
          console.log("Received mutation from client:", parsedMessage);
          try {
            const result = await server
              .handleRequest({
                req: {
                  type: "SET",
                  resourceName: resource,
                  payload: parsedMessage.payload,
                  context: { messageId: parsedMessage._id }, // TODO provide context
                  resourceId: parsedMessage.resourceId,
                },
              })
              .catch((e) => {
                console.error("Error handling mutation from the client:", e);
                return null;
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
            ws.send(
              JSON.stringify({
                _id: parsedMessage._id,
                type: "REJECT",
                resource,
              } satisfies ServerRejectMessage)
            );
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
