import { Awaitable, Generatable } from "../core/utils";
import { Schema } from "../schema";

export * from "./react";
export * from "./stateful/client";

export type ClientOptions = {
  url: string;
  schema: Schema<any>;
  credentials?: Generatable<Awaitable<Record<string, string>>>;
};
