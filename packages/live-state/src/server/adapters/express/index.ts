import { Application } from "express-ws";
import { AnyRouter, Server } from "../../";
import { httpTransportLayer } from "../../transport-layers/http";
import { webSocketAdapter } from "../../web-socket";
import { convertRequest } from "./convert-request";

export const expressAdapter = (app: Application, server: Server<AnyRouter>) => {
  app.ws("/ws", webSocketAdapter(server));
  app.use("/", (req, res) => {
    const response = httpTransportLayer(server)(convertRequest(req));
    response.then((r) =>
      r.json().then((body) => res.status(r.status).send(body))
    );
  });
};
