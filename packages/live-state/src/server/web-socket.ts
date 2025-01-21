import { WebsocketRequestHandler } from "express-ws";
import { AnyRouter } from ".";

export const createWSServer: <T extends AnyRouter>(
  router: T
) => WebsocketRequestHandler = (router) => {
  // TODO: Server implementation

  return (ws) => {
    ws.on("message", (message) => {
      console.log("Message received from the client:", message);
    });
  };
};
