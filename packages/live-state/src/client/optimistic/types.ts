import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
	InferInsert,
	InferLiveCollection,
	InferUpdate,
	LiveCollectionAny,
	Schema,
} from "../../schema";
import type { Simplify } from "../../utils";
import type { ClientRouterConstraint } from "../types";

/**
 * Extracts the output type from a Standard Schema validator.
 */
type InferSchema<T> = T extends { "~standard": { types?: { output: infer U } } }
	? U
	: T extends StandardSchemaV1<any, any>
		? StandardSchemaV1.InferOutput<T>
		: T extends { _output: infer U }
			? U
			: never;

/**
 * Operation types for optimistic mutations.
 */
export type OptimisticInsertOperation<T extends LiveCollectionAny> = {
	type: "insert";
	resource: string;
	id: string;
	data: Simplify<InferInsert<T>>;
};

export type OptimisticUpdateOperation<T extends LiveCollectionAny> = {
	type: "update";
	resource: string;
	id: string;
	data: Simplify<InferUpdate<T>>;
};

export type OptimisticOperation<T extends LiveCollectionAny = LiveCollectionAny> =
	| OptimisticInsertOperation<T>
	| OptimisticUpdateOperation<T>;

/**
 * Query builder type for the storage proxy (read-only operations).
 */
export type OptimisticQueryBuilder<T extends LiveCollectionAny> = {
	one: (id: string) => {
		get: () => Simplify<InferLiveCollection<T>> | undefined;
		include: <TInclude extends Record<string, boolean | object>>(
			include: TInclude
		) => {
			get: () => Simplify<InferLiveCollection<T, TInclude>> | undefined;
		};
	};
	where: (where: Record<string, unknown>) => {
		get: () => Simplify<InferLiveCollection<T>>[];
		include: <TInclude extends Record<string, boolean | object>>(
			include: TInclude
		) => {
			get: () => Simplify<InferLiveCollection<T, TInclude>>[];
		};
	};
	get: () => Simplify<InferLiveCollection<T>>[];
	include: <TInclude extends Record<string, boolean | object>>(
		include: TInclude
	) => {
		get: () => Simplify<InferLiveCollection<T, TInclude>>[];
	};
};

/**
 * Mutation methods for the storage proxy (write operations).
 */
export type OptimisticMutationMethods<T extends LiveCollectionAny> = {
	insert: (data: Simplify<InferInsert<T>> & { id: string }) => void;
	update: (id: string, data: Simplify<InferUpdate<T>>) => void;
};

/**
 * Combined storage proxy type with both query and mutation capabilities.
 */
export type OptimisticStorageProxy<TSchema extends Schema<any>> = {
	[K in keyof TSchema]: OptimisticQueryBuilder<TSchema[K]> &
		OptimisticMutationMethods<TSchema[K]>;
};

/**
 * Context passed to optimistic mutation handlers.
 */
export type OptimisticHandlerContext<
	TSchema extends Schema<any>,
	TInput,
> = {
	input: TInput;
	storage: OptimisticStorageProxy<TSchema>;
};

/**
 * Type for a single optimistic mutation handler.
 */
export type OptimisticMutationHandler<
	TSchema extends Schema<any>,
	TInput,
> = (ctx: OptimisticHandlerContext<TSchema, TInput>) => void;

/**
 * Configuration type for defineOptimisticMutations.
 * Maps route names to procedure names to handlers.
 */
export type OptimisticMutationsConfig<
	TRouter extends ClientRouterConstraint,
	TSchema extends Schema<any>,
> = {
	[K in keyof TRouter["routes"]]?: {
		[K2 in keyof TRouter["routes"][K]["customMutations"]]?: OptimisticMutationHandler<
			TSchema,
			InferSchema<TRouter["routes"][K]["customMutations"][K2]["inputValidator"]>
		>;
	};
};

/**
 * Registry type returned by defineOptimisticMutations.
 * Used internally to look up handlers by route and procedure.
 */
export type OptimisticMutationsRegistry<TSchema extends Schema<any>> = {
	getHandler: (
		route: string,
		procedure: string
	) => OptimisticMutationHandler<TSchema, any> | undefined;
};

/**
 * Internal type for tracking optimistic mutation batches.
 * Maps batch IDs to their associated mutation IDs.
 */
export type OptimisticBatchTracker = Map<string, string[]>;
