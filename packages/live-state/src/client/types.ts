import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ConditionalPromise, Promisify } from "../core/utils";
import type { InferInsert, InferUpdate, LiveObjectAny } from "../schema";
import type { Simplify } from "../utils";
import type { QueryBuilder } from "./query";

/**
 * Extracts the output type from a Standard Schema validator.
 * Supports Standard Schema (via ~standard property) and Zod schemas (via _output property for backward compatibility).
 */
type InferSchema<T> = T extends { "~standard": { types?: { output: infer U } } }
  ? U
  : T extends StandardSchemaV1<any, any>
    ? StandardSchemaV1.InferOutput<T>
    : T extends { _output: infer U }
      ? U
      : never;

/**
 * Helper type for custom mutation functions.
 * When the input type is `never` or `undefined`, the function has no parameters.
 */
type CustomMutationFunction<TInput, TOutput> = [TInput] extends
  | [never]
  | [undefined]
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
          inputValidator: StandardSchemaV1<any, any>;
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
