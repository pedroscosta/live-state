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

type CustomQueryResult<TOutput, TShouldAwait extends boolean = false> =
  UnwrapPromise<TOutput> extends QueryBuilder<
    infer TCollection,
    infer TInclude,
    infer TSingle,
    any
  >
    ? TShouldAwait extends true
      ? TSingle extends true
        ? Promise<
            Simplify<InferLiveObject<TCollection, TInclude>> | undefined
          >
        : Promise<Simplify<InferLiveObject<TCollection, TInclude>>[]>
      : TSingle extends true
        ? CustomQueryLoadable<
            Simplify<InferLiveObject<TCollection, TInclude>> | undefined
          >
        : CustomQueryLoadable<Simplify<InferLiveObject<TCollection, TInclude>>[]>
    : Promisify<UnwrapPromise<TOutput>>;

type CustomQueryFunction<
  TInput,
  TOutput,
  TShouldAwait extends boolean = false,
> = [TInput] extends [never] | [undefined]
  ? () => CustomQueryResult<TOutput, TShouldAwait>
  : (input: TInput) => CustomQueryResult<TOutput, TShouldAwait>;

/**
 * Simplified router constraint for client-side usage.
 * This avoids importing server-internal types like Storage and Hooks,
 * which can cause type incompatibilities when the package is bundled.
 */
export type ClientRouterConstraint = {
  routes: Record<
    string,
    {
      resourceSchema: LiveObjectAny | undefined;
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

type CollectionQueryType<
  TRoute extends ClientRouterConstraint["routes"][string],
  TShouldAwait extends boolean,
> = TRoute["resourceSchema"] extends LiveObjectAny
  ? QueryBuilder<TRoute["resourceSchema"], {}, false, TShouldAwait> & {
      [K2 in keyof TRoute["customQueries"]]: CustomQueryFunction<
        InferSchema<TRoute["customQueries"][K2]["inputValidator"]>,
        ReturnType<TRoute["customQueries"][K2]["handler"]>,
        TShouldAwait
      >;
    }
  : {
      [K2 in keyof TRoute["customQueries"]]: CustomQueryFunction<
        InferSchema<TRoute["customQueries"][K2]["inputValidator"]>,
        ReturnType<TRoute["customQueries"][K2]["handler"]>,
        TShouldAwait
      >;
    };

type CollectionMutateType<
  TRoute extends ClientRouterConstraint["routes"][string],
  TShouldAwait extends boolean,
> = TRoute["resourceSchema"] extends LiveObjectAny
  ? {
      /** @deprecated Use custom mutations instead. Default insert will be removed in a future version. */
      insert: (
        input: Simplify<InferInsert<TRoute["resourceSchema"]>>
      ) => ConditionalPromise<void, TShouldAwait>;
      /** @deprecated Use custom mutations instead. Default update will be removed in a future version. */
      update: (
        id: string,
        value: Simplify<InferUpdate<TRoute["resourceSchema"]>>
      ) => ConditionalPromise<void, TShouldAwait>;
    } & {
      [K2 in keyof TRoute["customMutations"]]: CustomMutationFunction<
        InferSchema<TRoute["customMutations"][K2]["inputValidator"]>,
        ReturnType<TRoute["customMutations"][K2]["handler"]>
      >;
    }
  : {
      [K2 in keyof TRoute["customMutations"]]: CustomMutationFunction<
        InferSchema<TRoute["customMutations"][K2]["inputValidator"]>,
        ReturnType<TRoute["customMutations"][K2]["handler"]>
      >;
    };

export type Client<
  TRouter extends ClientRouterConstraint,
  TShouldAwait extends boolean = false,
> = {
  query: {
    [K in keyof TRouter["routes"]]: CollectionQueryType<
      TRouter["routes"][K],
      TShouldAwait
    >;
  };
  mutate: {
    [K in keyof TRouter["routes"]]: CollectionMutateType<
      TRouter["routes"][K],
      TShouldAwait
    >;
  };
};
