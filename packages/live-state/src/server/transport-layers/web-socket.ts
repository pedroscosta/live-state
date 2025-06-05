import cookie from "cookie";
import { parse } from "qs";
import WebSocket from "ws";
import { AnyRouter, Server } from "../";
import {
  DefaultMutation,
  GenericMutation,
} from "../../core/schemas/core-protocol";
import {
  clientMessageSchema,
  MutationMessage,
  ServerMessage,
} from "../../core/schemas/web-socket";
import { generateId } from "../../core/utils";
import { LiveObjectAny, MaterializedLiveType } from "../../schema";

export type Subscription = {
  filters?: Record<string, any>;
};

export const webSocketAdapter = (server: Server<AnyRouter>) => {
  const connections: Record<string, WebSocket> = {};
  const subscriptions: Record<string, Record<string, Subscription>> = {};

  server.subscribeToMutations((_m) => {
    const m = _m as DefaultMutation;

    if (!m.resourceId || !m.payload) return;

    console.log("Mutation propagated:", m);

    Object.entries(subscriptions[m.resource] ?? {}).forEach(
      ([clientId, sub]) => {
        // TODO handle subscription filters
        connections[clientId]?.send(
          JSON.stringify({
            ...m,
            id: m.id ?? generateId(),
          } satisfies MutationMessage)
        );
      }
    );
  });

  // TODO make this adapter agnostic
  return (ws: WebSocket, request: any) => {
    const reply = (msg: ServerMessage) => {
      ws.send(JSON.stringify(msg));
    };

    const clientId = generateId();

    const requestContext: {
      headers: Record<string, any>;
      cookies: Record<string, any>;
    } = {
      headers: request.headers,
      cookies:
        typeof request.headers.cookie === "string"
          ? cookie.parse(request.headers.cookie)
          : {},
    };

    const parsedQs = parse(request.url.split("?")[1]) as Record<string, any>;

    const initialContext = server.contextProvider?.({
      transport: "WEBSOCKET",
      headers: requestContext.headers,
      cookies: requestContext.cookies,
      query: parsedQs,
    });

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
                  ...requestContext,
                  type: "QUERY",
                  resourceName,
                  context: (await initialContext) ?? {},
                  query: parsedQs,
                },
              });

              if (!result || !result.data) {
                throw new Error("Invalid resource");
              }

              reply({
                id: parsedMessage.id,
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
              });
            })
          );
        } else if (parsedMessage.type === "MUTATE") {
          const { resource } = parsedMessage;
          console.log("Received mutation from client:", parsedMessage);
          try {
            const result = await server.handleRequest({
              req: {
                ...requestContext,
                type: "MUTATE",
                resourceName: resource,
                input: parsedMessage.payload,
                context: {
                  messageId: parsedMessage.id,
                  ...((await initialContext) ?? {}),
                },
                resourceId: (parsedMessage as DefaultMutation).resourceId,
                procedure: (parsedMessage as GenericMutation).procedure,
                query: parsedQs,
              },
            });

            if ((parsedMessage as GenericMutation).procedure) {
              reply({
                id: parsedMessage.id,
                type: "REPLY",
                data: result,
              });
            }
          } catch (e) {
            reply({
              id: parsedMessage.id,
              type: "REJECT",
              resource,
              message: (e as Error).message,
            });
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
      for (const subs of Object.values(subscriptions)) {
        delete subs[clientId];
      }
    });
  };
};
