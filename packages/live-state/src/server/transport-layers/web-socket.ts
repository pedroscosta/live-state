/** biome-ignore-all lint/suspicious/noExplicitAny: too much work to fix right now -- PRs welcome! */
import cookie from "cookie";
import { parse } from "qs";
import type WebSocket from "ws";
import type {
  DefaultMutation,
  GenericMutation,
} from "../../core/schemas/core-protocol";
import {
  clientMessageSchema,
  type MutationMessage,
  type ServerMessage,
} from "../../core/schemas/web-socket";
import { generateId } from "../../core/utils";
import type { LiveObjectAny, MaterializedLiveType } from "../../schema";
import type { AnyRouter, Server } from "../";

export type Subscription = {
  filters?: Record<string, any>;
};

export const webSocketAdapter = (server: Server<AnyRouter>) => {
  const connections: Record<string, WebSocket> = {};
  const subscriptions: Record<string, Record<string, Subscription>> = {};
  const logger = server.logger;

  server.subscribeToMutations((_m) => {
    const m = _m as DefaultMutation;

    if (!m.resourceId || !m.payload) return;

    logger.debug("Mutation propagated:", m);

    Object.entries(subscriptions[m.resource] ?? {}).forEach(
      ([clientId, _sub]) => {
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
      queryParams: parsedQs,
    });

    connections[clientId] = ws;
    logger.info("Client connected:", clientId);

    ws.on("message", async (message) => {
      try {
        logger.debug("Message received from the client:", message);

        const parsedMessage = clientMessageSchema.parse(
          JSON.parse(message.toString())
        );

        if (parsedMessage.type === "SUBSCRIBE") {
          const { resource } = parsedMessage;

          if (!subscriptions[resource]) subscriptions[resource] = {};

          subscriptions[resource][clientId] = {};

          // TODO send bootstrap
        } else if (parsedMessage.type === "QUERY") {
          const { resource } = parsedMessage;

          const result = await server.handleQuery({
            req: {
              ...requestContext,
              type: "QUERY",
              resource: resource,
              context: (await initialContext) ?? {},
              queryParams: parsedQs,
            },
          });

          if (!result || !result.data) {
            throw new Error("Invalid resource");
          }

          reply({
            id: parsedMessage.id,
            type: "REPLY",
            data: {
              resource,
              data: Object.fromEntries(
                Object.entries(
                  (result.data ?? {}) as Record<
                    string,
                    MaterializedLiveType<LiveObjectAny>
                  >
                ).map(([id, v]) => [id, v.value])
              ),
            },
          });
        } else if (parsedMessage.type === "MUTATE") {
          const { resource } = parsedMessage;
          logger.debug("Received mutation from client:", parsedMessage);
          try {
            const result = await server.handleMutation({
              req: {
                ...requestContext,
                type: "MUTATE",
                resource: resource,
                input: parsedMessage.payload,
                context: {
                  messageId: parsedMessage.id,
                  ...((await initialContext) ?? {}),
                },
                resourceId: (parsedMessage as DefaultMutation).resourceId,
                procedure: (parsedMessage as GenericMutation).procedure,
                queryParams: parsedQs,
              },
            });

            if (
              (parsedMessage as GenericMutation).procedure &&
              (parsedMessage as GenericMutation).procedure !== "INSERT" &&
              (parsedMessage as GenericMutation).procedure !== "UPDATE"
            ) {
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
            logger.error("Error parsing mutation from the client:", e);
          }
        }
      } catch (e) {
        // TODO send error to client
        logger.error("Error handling message from the client:", e);
      }
    });

    ws.on("close", () => {
      logger.info("Connection closed", clientId);
      delete connections[clientId];
      for (const subs of Object.values(subscriptions)) {
        delete subs[clientId];
      }
    });
  };
};
