/** biome-ignore-all lint/suspicious/noExplicitAny: hooks operate generically over any entity shape */

import {
	type InferLiveObjectWithRelationalIds,
	inferValue,
	type LiveObjectAny,
	type MaterializedLiveType,
	type Schema,
} from "../schema";
import type { Simplify } from "../utils";
import type { ServerDB } from "./storage/server-query-builder";

/**
 * Database lifecycle hooks.
 *
 * These fire from the storage layer around every committed write (insert /
 * update), regardless of how the write was produced — a custom mutation
 * handler calling `db.x.insert(...)`, a transaction, etc. They are *not* tied
 * to a particular mutation procedure.
 *
 * `before*` handlers may return a transformed raw value to replace what gets
 * persisted; returning `void` leaves the value unchanged. `after*` handlers run
 * once the write is committed.
 */
export type BeforeInsertHook<
	TShape extends LiveObjectAny,
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = (opts: {
	ctx?: TContext;
	value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
	rawValue: MaterializedLiveType<TShape>;
	db: ServerDB<TSchema>;
}) =>
	| Promise<MaterializedLiveType<TShape> | void>
	| MaterializedLiveType<TShape>
	| void;

export type AfterInsertHook<
	TShape extends LiveObjectAny,
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = (opts: {
	ctx?: TContext;
	value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
	rawValue: MaterializedLiveType<TShape>;
	db: ServerDB<TSchema>;
}) => Promise<void> | void;

export type BeforeUpdateHook<
	TShape extends LiveObjectAny,
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = (opts: {
	ctx?: TContext;
	value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
	rawValue: MaterializedLiveType<TShape>;
	previousValue?: Simplify<InferLiveObjectWithRelationalIds<TShape>> & {
		id: string;
	};
	previousRawValue?: MaterializedLiveType<TShape>;
	db: ServerDB<TSchema>;
}) =>
	| Promise<MaterializedLiveType<TShape> | void>
	| MaterializedLiveType<TShape>
	| void;

export type AfterUpdateHook<
	TShape extends LiveObjectAny,
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = (opts: {
	ctx?: TContext;
	value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
	rawValue: MaterializedLiveType<TShape>;
	previousValue?: Simplify<InferLiveObjectWithRelationalIds<TShape>> & {
		id: string;
	};
	previousRawValue?: MaterializedLiveType<TShape>;
	db: ServerDB<TSchema>;
}) => Promise<void> | void;

export type Hooks<
	TShape extends LiveObjectAny,
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = {
	beforeInsert?: BeforeInsertHook<TShape, TSchema, TContext>;
	afterInsert?: AfterInsertHook<TShape, TSchema, TContext>;
	beforeUpdate?: BeforeUpdateHook<TShape, TSchema, TContext>;
	afterUpdate?: AfterUpdateHook<TShape, TSchema, TContext>;
};

/**
 * Schema-keyed registry of database lifecycle hooks.
 *
 * Top-level keys are constrained to entity names on `TSchema`. Per-entity
 * payloads (`value`, `rawValue`, `previousValue`, …) are inferred from the
 * corresponding `TSchema[K]` collection shape.
 */
export type HooksRegistry<
	TSchema extends Schema<any>,
	TContext = Record<string, any>,
> = {
	[K in keyof TSchema]?: TSchema[K] extends LiveObjectAny
		? Hooks<TSchema[K], TSchema, TContext>
		: never;
};

/**
 * Declares database lifecycle hooks for a schema.
 *
 * Identity function whose generic parameters constrain the returned object's
 * top-level keys to schema entity names and thread `TContext` through to
 * handler payloads. Pass the result to `server({ hooks })`.
 *
 * @example
 * ```ts
 * const hooks = defineHooks<typeof schema, AppContext>({
 *   posts: {
 *     beforeInsert: ({ ctx, value }) => {
 *       if (ctx?.role !== "admin") throw new Error("Unauthorized");
 *     },
 *   },
 * });
 * ```
 */
export const defineHooks = <
	TSchema extends Schema<any>,
	TContext = Record<string, any>,
>(
	definition: HooksRegistry<TSchema, TContext>,
): HooksRegistry<TSchema, TContext> => definition;

const HOOK_NAMES = [
	"beforeInsert",
	"afterInsert",
	"beforeUpdate",
	"afterUpdate",
] as const satisfies readonly (keyof Hooks<any, any, any>)[];

type AnyHooks = Hooks<any, any, any>;

/**
 * Composes a sequence of `beforeInsert` / `beforeUpdate` handlers into a single
 * handler. The handlers run in order; if one returns a transformed raw value,
 * the next handler sees it via `value` / `rawValue`. A handler returning
 * `void` passes the current value through unchanged.
 */
const composeBeforeHandlers = <
	THook extends BeforeInsertHook<any, any, any> | BeforeUpdateHook<any, any, any>,
>(
	handlers: THook[],
): THook => {
	if (handlers.length === 1) return handlers[0]!;
	return (async (opts: any) => {
		let currentRaw: MaterializedLiveType<LiveObjectAny> = opts.rawValue;
		let currentValue: any = opts.value;
		let changed = false;
		for (const handler of handlers) {
			const result = await handler({
				...opts,
				value: currentValue,
				rawValue: currentRaw,
			});
			if (result) {
				currentRaw = result as MaterializedLiveType<LiveObjectAny>;
				currentValue = inferValue(currentRaw) as any;
				currentValue.id = opts.value.id;
				changed = true;
			}
		}
		return changed ? currentRaw : undefined;
	}) as THook;
};

/**
 * Composes a sequence of `afterInsert` / `afterUpdate` handlers into a single
 * handler that awaits each in order.
 */
const composeAfterHandlers = <
	THook extends AfterInsertHook<any, any, any> | AfterUpdateHook<any, any, any>,
>(
	handlers: THook[],
): THook => {
	if (handlers.length === 1) return handlers[0]!;
	return (async (opts: any) => {
		for (const handler of handlers) {
			await handler(opts);
		}
	}) as THook;
};

/**
 * Combines per-entity hook slices by chaining handlers for the same entity and
 * hook name in argument order.
 *
 * `before*` handlers thread their return value through the chain (a returned
 * raw value replaces the current value for subsequent handlers). `after*`
 * handlers simply run sequentially.
 */
export const mergeEntityHooks = (
	slices: Array<AnyHooks | undefined>,
): AnyHooks | undefined => {
	const defined = slices.filter((s): s is AnyHooks => s != null);
	if (defined.length === 0) return undefined;
	if (defined.length === 1) return defined[0]!;

	const merged: AnyHooks = {};
	for (const name of HOOK_NAMES) {
		const handlers = defined
			.map((s) => s[name])
			.filter((h): h is NonNullable<AnyHooks[typeof name]> => h != null);
		if (handlers.length === 0) continue;
		if (name === "afterInsert" || name === "afterUpdate") {
			(merged as any)[name] = composeAfterHandlers(handlers as any);
		} else {
			(merged as any)[name] = composeBeforeHandlers(handlers as any);
		}
	}
	return merged;
};

/**
 * Combines multiple `defineHooks` slices into a single registry. Handlers for
 * the same entity and hook name run sequentially in argument order; a slice
 * that transforms a value in `beforeInsert` / `beforeUpdate` hands the result
 * to subsequent slices.
 */
export const mergeHooks = <
	TSchema extends Schema<any>,
	TContext = Record<string, any>,
>(
	...definitions: HooksRegistry<TSchema, TContext>[]
): HooksRegistry<TSchema, TContext> => {
	const result: Record<string, AnyHooks> = {};
	const entityKeys = new Set<string>();
	for (const def of definitions) {
		for (const key of Object.keys(def as Record<string, unknown>)) {
			entityKeys.add(key);
		}
	}
	for (const key of Array.from(entityKeys)) {
		const slices = definitions.map(
			(def) => (def as Record<string, AnyHooks | undefined>)[key],
		);
		const merged = mergeEntityHooks(slices);
		if (merged) result[key] = merged;
	}
	return result as HooksRegistry<TSchema, TContext>;
};
