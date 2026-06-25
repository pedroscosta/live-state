import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { QueryBuilder } from '../core/query';
import type { CustomQueryRequest } from '../core/schemas/core-protocol';
import type { Promisify } from '../core/utils';
import type { InferLiveObject, LiveObjectAny } from '../schema';
import type { Simplify } from '../utils';

/**
 * Extracts the output type from a Standard Schema validator.
 * Supports Standard Schema (via ~standard property) and Zod schemas (via _output property for backward compatibility).
 */
type InferSchema<T> = T extends { '~standard': { types?: { output: infer U } } }
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

type CustomQueryResult<
	TOutput,
	TShouldAwait extends boolean = false,
> = UnwrapPromise<TOutput> extends QueryBuilder<
	infer TCollection,
	infer TInclude,
	infer TSingle,
	any
>
	? TShouldAwait extends true
		? TSingle extends true
			? Promise<Simplify<InferLiveObject<TCollection, TInclude>> | undefined>
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
 * Simplified, client-safe view of a route. Routes are now procedure-only
 * (decoupled from the schema, see ADR-0002); a resource is queryable by virtue
 * of being in the `schema`, not because a route is declared for it.
 */
type ClientRouteConstraint = {
	customMutations: Record<
		string,
		{
			_type: 'mutation';
			inputValidator: StandardSchemaV1<any, any>;
			handler: (...args: any[]) => any;
		}
	>;
	customQueries: Record<
		string,
		{
			_type: 'query';
			inputValidator: StandardSchemaV1<any, any>;
			handler: (...args: any[]) => any;
		}
	>;
};

export type ClientRouterConstraint = {
	schema: Record<string, LiveObjectAny>;
	routes: Record<string, ClientRouteConstraint>;
};

type CustomQueryMethods<
	TRoute extends ClientRouteConstraint,
	TShouldAwait extends boolean,
> = {
	[K2 in keyof TRoute['customQueries']]: CustomQueryFunction<
		InferSchema<TRoute['customQueries'][K2]['inputValidator']>,
		ReturnType<TRoute['customQueries'][K2]['handler']>,
		TShouldAwait
	>;
};

/**
 * The client `store.query.<resource>` surface, asymmetric by client (ADR-0002):
 *
 * - **Websocket** (`TShouldAwait = false`): every resource in the `schema`
 *   exposes a `QueryBuilder` **Local Query** — `.where()/.get()/.subscribe()`
 *   read the optimistic store with no server round-trip (consumed by
 *   `useLiveQuery`) — merged with the declared **Custom Query** procedures of a
 *   route of the same name (if any).
 * - **Fetch** (`TShouldAwait = true`): no optimistic store to back a Local
 *   Query, so only the declared Custom Query procedures are exposed.
 */
type WsQueryType<
	TRouter extends ClientRouterConstraint,
	K,
> = (K extends keyof TRouter['schema']
	? TRouter['schema'][K] extends LiveObjectAny
		? QueryBuilder<TRouter['schema'][K], {}, false, false>
		: unknown
	: unknown) &
	(K extends keyof TRouter['routes']
		? CustomQueryMethods<TRouter['routes'][K], false>
		: unknown);

type CollectionMutateType<TRoute extends ClientRouteConstraint> = {
	[K2 in keyof TRoute['customMutations']]: CustomMutationFunction<
		InferSchema<TRoute['customMutations'][K2]['inputValidator']>,
		ReturnType<TRoute['customMutations'][K2]['handler']>
	>;
};

export type Client<
	TRouter extends ClientRouterConstraint,
	TShouldAwait extends boolean = false,
> = {
	query: TShouldAwait extends true
		? {
				[K in keyof TRouter['routes']]: CustomQueryMethods<
					TRouter['routes'][K],
					true
				>;
			}
		: {
				[K in keyof TRouter['schema'] | keyof TRouter['routes']]: WsQueryType<
					TRouter,
					K
				>;
			};
	mutate: {
		[K in keyof TRouter['routes']]: CollectionMutateType<TRouter['routes'][K]>;
	};
};
