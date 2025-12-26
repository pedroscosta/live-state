import { SQLStorage, expressAdapter, server } from "@live-state/sync/server";
import { routerImpl } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";
import cors from "cors";
import express from "express";
import expressWs from "express-ws";
import morgan from "morgan";
import { Pool } from "pg";
import { LogLevel } from "@live-state/sync";

const lsServer = server({
  router: routerImpl,
  storage: new SQLStorage(
    new Pool({
      connectionString: "postgresql://admin:admin@localhost:5442/live-state",
    })
  ),
  schema,
  logLevel: LogLevel.DEBUG,
});

export const createServer = (): ReturnType<typeof expressWs>["app"] => {
  const { app } = expressWs(express());

  app
    .disable("x-powered-by")
    .use(morgan("dev"))
    .use(express.urlencoded({ extended: true }))
    .use(express.json())
    .use(cors());

  expressAdapter(app, lsServer);

  return app;
};
