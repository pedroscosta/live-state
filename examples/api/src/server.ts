import { routerImpl, schema } from "@repo/ls-impl";
import cors from "cors";
import express from "express";
import expressWs from "express-ws";
import { InMemoryStorage, server, webSocketAdapter } from "live-state/server";
import morgan from "morgan";

const lsServer = server({
  router: routerImpl,
  storage: new InMemoryStorage(),
  schema,
});

export const createServer = (): ReturnType<typeof expressWs>["app"] => {
  const { app } = expressWs(express());

  app
    .disable("x-powered-by")
    .use(morgan("dev"))
    .use(express.urlencoded({ extended: true }))
    .use(express.json())
    .use(cors())
    .get("/message/:name", (req, res) => {
      return res.json({ message: `hello ${req.params.name}` });
    })
    .get("/status", (_, res) => {
      return res.json({ ok: true });
    });

  app.ws("/ws", webSocketAdapter(lsServer));

  return app;
};
