import type { ConditionalPromise, Promisify } from "../core/utils";
import type { InferInsert, InferUpdate, LiveObjectAny } from "../schema";
import type { Simplify } from "../utils";
import type { QueryBuilder } from "./query";

/**
 * Extracts the output type from a zod-like schema (mirrors z.infer behavior).
 * TODO: Use StandardSchema instead
 */
type InferableSchema = { _output: unknown };
type InferSchema<T extends InferableSchema> = T["_output"];

/**
 * Simplified router constraint for client-side usage.
 * This avoids importing server-internal types like Storage and Hooks,
 * which can cause type incompatibilities when the package is bundled.
 */
export type ClientRouterConstraint = {
  routes: Record<
    string,
    {
      resourceSchema: LiveObjectAny;
      customMutations: Record<
        string,
        {
          inputValidator: InferableSchema;
          handler: (...args: any[]) => any;
        }
      >;
    }
  >;
};

export type Client<
  TRouter extends ClientRouterConstraint,
  TShouldAwait extends boolean = false,
> = {
  query: {
    [K in keyof TRouter["routes"]]: QueryBuilder<
      TRouter["routes"][K]["resourceSchema"],
      {},
      false,
      TShouldAwait
    >;
  };
  mutate: {
    [K in keyof TRouter["routes"]]: {
      insert: (
        input: Simplify<InferInsert<TRouter["routes"][K]["resourceSchema"]>>
      ) => ConditionalPromise<void, TShouldAwait>;
      update: (
        id: string,
        value: Simplify<InferUpdate<TRouter["routes"][K]["resourceSchema"]>>
      ) => ConditionalPromise<void, TShouldAwait>;
    } & {
      [K2 in keyof TRouter["routes"][K]["customMutations"]]: (
        input: InferSchema<
          TRouter["routes"][K]["customMutations"][K2]["inputValidator"]
        >
      ) => Promisify<
        ReturnType<TRouter["routes"][K]["customMutations"][K2]["handler"]>
      >;
    };
  };
};
