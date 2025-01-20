import { createMiddleware } from "@repo/live-state/server";
import { lsRouter } from "@repo/ls-impl";
import { json, urlencoded } from "body-parser";
import cors from "cors";
import express from "express";
import expressWs from "express-ws";
import morgan from "morgan";

export const createServer = (): ReturnType<typeof expressWs>["app"] => {
  const { app } = expressWs(express());

  app
    .disable("x-powered-by")
    .use(morgan("dev"))
    .use(urlencoded({ extended: true }))
    .use(json())
    .use(cors())
    .get("/message/:name", (req, res) => {
      return res.json({ message: `hello ${req.params.name}` });
    })
    .get("/status", (_, res) => {
      return res.json({ ok: true });
    });

  app.ws("/ws", createMiddleware(lsRouter));

  return app;
};
