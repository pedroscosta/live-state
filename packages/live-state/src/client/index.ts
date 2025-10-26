import type { Awaitable, Generatable } from "../core/utils";
import type { Schema } from "../schema";
import type { LogLevel } from "../utils";

export * from "./react";
export * from "./websocket/client";

export type ClientOptions = {
  url: string;
  schema: Schema<any>;
  credentials?: Generatable<Awaitable<Record<string, string>>>;
  storage:
    | {
        name: string;
      }
    | false;
  logLevel?: LogLevel;
};
