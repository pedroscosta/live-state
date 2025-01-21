import { createWSServer } from "@repo/live-state/server";
import { router } from "@repo/ls-impl";
import cors from "cors";
import express from "express";
import expressWs from "express-ws";
import morgan from "morgan";

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

  app.ws("/ws", createWSServer(router));

  return app;
};
