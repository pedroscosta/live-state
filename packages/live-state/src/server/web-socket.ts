import { WebsocketRequestHandler } from "express-ws";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { AnyRouter } from ".";
import { ServerMessage } from "../core";
import { clientMessageSchema } from "../core/internals";

let counter = 0;

export type Subscription = {
  __subscribed: true;
  filters?: Record<string, any>;
};

export const createWSServer: <T extends AnyRouter>(
  router: T
) => WebsocketRequestHandler = (router) => {
  // TODO: Server implementation
  const connections: Record<string, WebSocket> = {};
  const subscriptions: Record<string, Record<string, Subscription>> = {};

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

  setInterval(() => {
    console.log("Updating counter");
    counter++;

    propagateMutations("counter", [
      {
        value: counter,
        _metadata: { timestamp: new Date().toISOString() },
      },
    ]);
  }, 1000);

  return (ws) => {
    const clientId = nanoid();

    connections[clientId] = ws;

    ws.on("message", (message) => {
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
