import { WebsocketRequestHandler } from "express-ws";
import { AnyLiveStateRouter } from ".";

export const createMiddleware: <T extends AnyLiveStateRouter>(
  router: T
) => WebsocketRequestHandler = (ls) => {
  return (ws) => {
    ls.addConnection(ws);
  };
};
