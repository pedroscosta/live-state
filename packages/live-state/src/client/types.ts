import type { ConditionalPromise, Promisify } from "../core/utils";
import type { InferInsert, InferUpdate, LiveObjectAny } from "../schema";
import type { Simplify } from "../utils";
import type { QueryBuilder } from "./query";

/**
 * Extracts the output type from a zod-like schema (mirrors z.infer behavior).
 * TODO: Use StandardSchema instead
 */
type InferSchema<T> = T extends { _output: infer U } ? U : never;

/**
 * Helper type for custom mutation functions.
 * When the input type is `never`, the function has no parameters.
 */
type CustomMutationFunction<TInput, TOutput> = [TInput] extends [never]
  ? () => Promisify<TOutput>
  : (input: TInput) => Promisify<TOutput>;

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
          inputValidator: any;
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
      [K2 in keyof TRouter["routes"][K]["customMutations"]]: CustomMutationFunction<
        InferSchema<
          TRouter["routes"][K]["customMutations"][K2]["inputValidator"]
        >,
        ReturnType<TRouter["routes"][K]["customMutations"][K2]["handler"]>
      >;
    };
  };
};
