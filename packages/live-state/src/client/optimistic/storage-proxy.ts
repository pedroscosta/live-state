import type { Schema } from "../../schema";
import type { OptimisticStore } from "../websocket/store";
import type {
	OptimisticOperation,
	OptimisticStorageProxy,
} from "./types";

/**
 * Creates an optimistic storage proxy that:
 * - Provides synchronous read access to the optimistic state via QueryBuilder-like methods
 * - Collects insert/update operations in an internal array
 * - Returns collected operations via getOperations()
 */
export const createOptimisticStorageProxy = <TSchema extends Schema<any>>(
	store: OptimisticStore,
	schema: TSchema
): {
	proxy: OptimisticStorageProxy<TSchema>;
	getOperations: () => OptimisticOperation[];
} => {
	const operations: OptimisticOperation[] = [];

	const createResourceProxy = (resourceName: string) => {
		const buildQuery = (
			whereClause?: Record<string, unknown>,
			includeClause?: Record<string, boolean | object>,
			single?: boolean,
			singleId?: string
		) => {
			const executeQuery = () => {
				const query = {
					resource: resourceName,
					where: singleId ? { id: singleId } : whereClause ?? {},
					include: includeClause ?? {},
					limit: single ? 1 : undefined,
				};
				const result = store.get(query);
				return single ? result[0] : result;
			};

			return {
				get: executeQuery,
				include: <TInclude extends Record<string, boolean | object>>(
					include: TInclude
				) => ({
					get: () => {
						const query = {
							resource: resourceName,
							where: singleId ? { id: singleId } : whereClause ?? {},
							include: include ?? {},
							limit: single ? 1 : undefined,
						};
						const result = store.get(query);
						return single ? result[0] : result;
					},
				}),
			};
		};

		return {
			// Query methods (read from optimistic state)
			one: (id: string) => buildQuery(undefined, undefined, true, id),
			where: (where: Record<string, unknown>) =>
				buildQuery(where, undefined, false),
			get: () => buildQuery().get(),
			include: <TInclude extends Record<string, boolean | object>>(
				include: TInclude
			) => buildQuery(undefined, include, false),

			// Mutation methods (collect operations)
			insert: (data: { id: string; [key: string]: unknown }) => {
				const { id, ...rest } = data;
				operations.push({
					type: "insert",
					resource: resourceName,
					id,
					data: rest,
				});
			},
			update: (id: string, data: Record<string, unknown>) => {
				operations.push({
					type: "update",
					resource: resourceName,
					id,
					data,
				});
			},
		};
	};

	const proxy = new Proxy({} as OptimisticStorageProxy<TSchema>, {
		get(_, prop) {
			if (typeof prop === "string" && prop in schema) {
				return createResourceProxy(prop);
			}
			return undefined;
		},
	});

	return {
		proxy,
		getOperations: () => operations,
	};
};
