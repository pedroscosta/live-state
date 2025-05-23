import { SQLStorage, server, webSocketAdapter } from "@live-state/sync/server";
import { routerImpl, schema } from "@repo/ls-impl";
import cors from "cors";
import express from "express";
import expressWs from "express-ws";
import morgan from "morgan";
import { Pool } from "pg";

const lsServer = server({
  router: routerImpl,
  storage: new SQLStorage(
    new Pool({
      connectionString: "postgresql://admin:admin@localhost:5432/live-state",
    })
  ),
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
