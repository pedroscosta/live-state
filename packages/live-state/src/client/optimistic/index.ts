import type { Schema } from "../../schema";
import type { ClientRouterConstraint } from "../types";
import type {
	OptimisticMutationsConfig,
	OptimisticMutationsRegistry,
} from "./types";

export type {
	OptimisticMutationsConfig,
	OptimisticMutationsRegistry,
	OptimisticHandlerContext,
	OptimisticStorageProxy,
	OptimisticOperation,
	OptimisticInsertOperation,
	OptimisticUpdateOperation,
	OptimisticMutationHandler,
} from "./types";

export { createOptimisticStorageProxy } from "./storage-proxy";

/**
 * Defines optimistic mutation handlers for custom mutations.
 *
 * These handlers are executed client-side before the mutation is sent to the server,
 * allowing for instant UI updates. If the server rejects the mutation, the optimistic
 * changes are automatically rolled back.
 *
 * @example
 * ```ts
 * const optimisticMutations = defineOptimisticMutations<typeof router, typeof schema>({
 *   posts: {
 *     like: ({ input, storage }) => {
 *       const post = storage.posts.one(input.postId).get();
 *       if (post) {
 *         storage.posts.update(input.postId, { likes: post.likes + 1 });
 *       }
 *     },
 *   },
 * });
 *
 * const client = createClient({
 *   url: 'ws://localhost:3000',
 *   schema,
 *   optimisticMutations,
 * });
 * ```
 */
export const defineOptimisticMutations = <
	TRouter extends ClientRouterConstraint,
	TSchema extends Schema<any>,
>(
	config: OptimisticMutationsConfig<TRouter, TSchema>
): OptimisticMutationsRegistry<TSchema> => {
	const handlers = new Map<string, Map<string, (...args: any[]) => void>>();

	for (const [routeName, procedures] of Object.entries(config)) {
		if (!procedures) continue;

		const procedureMap = new Map<string, (...args: any[]) => void>();

		for (const [procedureName, handler] of Object.entries(procedures)) {
			if (handler && typeof handler === "function") {
				procedureMap.set(procedureName, handler as (...args: any[]) => void);
			}
		}

		if (procedureMap.size > 0) {
			handlers.set(routeName, procedureMap);
		}
	}

	return {
		getHandler: (route: string, procedure: string) => {
			return handlers.get(route)?.get(procedure);
		},
	};
};
