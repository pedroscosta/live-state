import type { Generatable, PromiseOrSync } from "../core/utils";
import type { Schema } from "../schema";
import type { LogLevel } from "../utils";
import type { OptimisticMutationsRegistry } from "./optimistic";

export * from "./react";
export type { ClientRouterConstraint } from "./types";
export * from "./websocket/client";
export type {
  OptimisticMutationsConfig,
  OptimisticMutationsRegistry,
  OptimisticHandlerContext,
  OptimisticStorageProxy,
  OptimisticOperation,
} from "./optimistic";
export { defineOptimisticMutations } from "./optimistic";

export type ClientOptions<TSchema extends Schema<any> = Schema<any>> = {
  url: string;
  schema: TSchema;
  credentials?: Generatable<PromiseOrSync<Record<string, string>>>;
  storage:
    | {
        name: string;
      }
    | false;
  logLevel?: LogLevel;
  optimisticMutations?: OptimisticMutationsRegistry<TSchema>;
};
