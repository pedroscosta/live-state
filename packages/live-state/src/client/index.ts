import type { Generatable, PromiseOrSync } from "../core/utils";
import type { Schema } from "../schema";
import type { LogLevel } from "../utils";

export * from "./react";
export type { ClientRouterConstraint } from "./types";
export * from "./websocket/client";

export type ClientOptions = {
  url: string;
  schema: Schema<any>;
  credentials?: Generatable<PromiseOrSync<Record<string, string>>>;
  storage:
    | {
        name: string;
      }
    | false;
  logLevel?: LogLevel;
};
