import { Application } from "express-ws";
import { AnyRouter, Server } from "../../";
import { httpTransportLayer } from "../../transport-layers/http";
import { webSocketAdapter } from "../../transport-layers/web-socket";
import { convertRequest } from "./convert-request";

export const expressAdapter = (
  app: Application,
  server: Server<AnyRouter>,
  options?: {
    basePath?: string;
  }
) => {
  app.ws(`${options?.basePath ?? ""}/ws`, webSocketAdapter(server));
  app.use(`${options?.basePath ?? ""}/`, (req, res) => {
    const response = httpTransportLayer(server)(convertRequest(req));
    response.then((r) =>
      r.json().then((body) => res.status(r.status).send(body))
    );
  });
};
