import { SQLStorage, expressAdapter, server } from "@live-state/sync/server";
import cors from "cors";
import express from "express";
import expressWs from "express-ws";
import morgan from "morgan";
import { Pool } from "pg";
import { appRouter } from "./router";
import { schema } from "./schema";

const lsServer = server({
  router: appRouter,
  storage: new SQLStorage(
    new Pool({
      connectionString: "postgresql://admin:admin@localhost:5442/ls-complex",
    })
  ),
  schema,
  contextProvider: async ({ headers }) => {
    return {
      user: headers["user"],
    };
  },
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
