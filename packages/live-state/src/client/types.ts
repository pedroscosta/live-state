import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { QueryBuilder } from "../core/query";
import type { CustomQueryRequest } from "../core/schemas/core-protocol";
import type { ConditionalPromise, Promisify } from "../core/utils";
import type {
  InferInsert,
  InferLiveObject,
  InferUpdate,
  LiveObjectAny,
} from "../schema";
import type { Simplify } from "../utils";

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
 * Helper type for custom query functions.
 * When the input type is `never` or `undefined`, the function has no parameters.
 */
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type CustomQueryLoadable<TOutput> = PromiseLike<TOutput> & {
  buildQueryRequest: () => CustomQueryRequest;
};

type CustomQueryResult<TOutput> = UnwrapPromise<TOutput> extends QueryBuilder<
  infer TCollection,
  infer TInclude,
  infer TSingle,
  any
>
  ? TSingle extends true
    ? CustomQueryLoadable<
        Simplify<InferLiveObject<TCollection, TInclude>> | undefined
      >
    : CustomQueryLoadable<Simplify<InferLiveObject<TCollection, TInclude>>[]>
  : Promisify<UnwrapPromise<TOutput>>;

type CustomQueryFunction<TInput, TOutput> = [TInput] extends
  | [never]
  | [undefined]
  ? () => CustomQueryResult<TOutput>
  : (input: TInput) => CustomQueryResult<TOutput>;

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
          _type: "mutation";
          inputValidator: StandardSchemaV1<any, any>;
          handler: (...args: any[]) => any;
        }
      >;
      customQueries: Record<
        string,
        {
          _type: "query";
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
    > & {
      [K2 in keyof TRouter["routes"][K]["customQueries"]]: CustomQueryFunction<
        InferSchema<
          TRouter["routes"][K]["customQueries"][K2]["inputValidator"]
        >,
        ReturnType<TRouter["routes"][K]["customQueries"][K2]["handler"]>
      >;
    };
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
