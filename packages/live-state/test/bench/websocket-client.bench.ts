import { bench, describe, beforeAll, afterAll } from "vitest";
import {
	createRelations,
	createSchema,
	id,
	number,
	reference,
	string,
	object,
} from "../../src/schema";
import { OptimisticStore } from "../../src/client/websocket/store";
import type { DefaultMutationMessage } from "../../src/core/schemas/web-socket";
import { generateId } from "../../src/core/utils";
import { createLogger, LogLevel } from "../../src/utils";

/**
 * Schema for benchmarking - deep nesting: orgs -> posts -> comments -> users
 */
const org = object("orgs", {
	id: id(),
	name: string(),
});

const user = object("users", {
	id: id(),
	name: string(),
	email: string(),
});

const post = object("posts", {
	id: id(),
	title: string(),
	content: string(),
	orgId: reference("orgs.id"),
	authorId: reference("users.id"),
	likes: number(),
});

const comment = object("comments", {
	id: id(),
	content: string(),
	postId: reference("posts.id"),
	authorId: reference("users.id"),
});

const orgRelations = createRelations(org, ({ many }) => ({
	posts: many(post, "orgId"),
}));

const userRelations = createRelations(user, ({ many }) => ({
	posts: many(post, "authorId"),
	comments: many(comment, "authorId"),
}));

const postRelations = createRelations(post, ({ one, many }) => ({
	org: one(org, "orgId"),
	author: one(user, "authorId"),
	comments: many(comment, "postId"),
}));

const commentRelations = createRelations(comment, ({ one }) => ({
	post: one(post, "postId"),
	author: one(user, "authorId"),
}));

const benchmarkSchema = createSchema({
	orgs: org,
	users: user,
	posts: post,
	comments: comment,
	orgRelations,
	userRelations,
	postRelations,
	commentRelations,
});

const logger = createLogger({ level: LogLevel.ERROR });

// ============================================================================
// TYPES AND UTILITIES
// ============================================================================

type DataConfig = {
	orgs: number;
	usersPerOrg: number;
	postsPerOrg: number;
	commentsPerPost: number;
};

type StoreData = {
	orgIds: string[];
	userIds: string[];
	postIds: string[];
	commentIds: string[];
};

type BenchmarkState = {
	store: OptimisticStore;
	data: StoreData;
};

/**
 * Helper to create a mutation message
 */
function createMutation(
	resource: string,
	resourceId: string,
	payload: Record<string, unknown>,
	procedure: "INSERT" | "UPDATE" = "INSERT"
): DefaultMutationMessage {
	const timestamp = new Date().toISOString();
	return {
		id: generateId(),
		type: "MUTATE",
		resource,
		resourceId,
		procedure,
		payload: Object.fromEntries(
			Object.entries(payload).map(([k, v]) => [
				k,
				{ value: v, _meta: { timestamp } },
			])
		),
	};
}

/**
 * Creates test data directly in the store
 */
function primeStoreWithData(store: OptimisticStore, config: DataConfig): StoreData {
	const orgIds: string[] = [];
	const userIds: string[] = [];
	const postIds: string[] = [];
	const commentIds: string[] = [];

	// Create orgs
	for (let i = 0; i < config.orgs; i++) {
		const orgId = generateId();
		orgIds.push(orgId);
		store.addMutation(
			"orgs",
			createMutation("orgs", orgId, { id: orgId, name: `Organization ${i}` })
		);
	}

	// Create users
	for (let orgIdx = 0; orgIdx < config.orgs; orgIdx++) {
		for (let i = 0; i < config.usersPerOrg; i++) {
			const userId = generateId();
			userIds.push(userId);
			store.addMutation(
				"users",
				createMutation("users", userId, {
					id: userId,
					name: `User ${orgIdx}-${i}`,
					email: `user${orgIdx}-${i}@example.com`,
				})
			);
		}
	}

	// Create posts
	for (let orgIdx = 0; orgIdx < config.orgs; orgIdx++) {
		for (let i = 0; i < config.postsPerOrg; i++) {
			const postId = generateId();
			postIds.push(postId);
			const authorId = userIds[(orgIdx * config.usersPerOrg + i) % userIds.length];
			store.addMutation(
				"posts",
				createMutation("posts", postId, {
					id: postId,
					title: `Post ${orgIdx}-${i}`,
					content: `Content for post ${orgIdx}-${i}`,
					orgId: orgIds[orgIdx],
					authorId,
					likes: i % 100,
				})
			);
		}
	}

	// Create comments
	for (let postIdx = 0; postIdx < postIds.length; postIdx++) {
		for (let i = 0; i < config.commentsPerPost; i++) {
			const commentId = generateId();
			commentIds.push(commentId);
			const authorId = userIds[(postIdx + i) % userIds.length];
			store.addMutation(
				"comments",
				createMutation("comments", commentId, {
					id: commentId,
					content: `Comment ${postIdx}-${i}`,
					postId: postIds[postIdx],
					authorId,
				})
			);
		}
	}

	return { orgIds, userIds, postIds, commentIds };
}

/**
 * Creates a setup function for benchmarks that initializes state if not already done
 */
function createSetupFn(
	stateRef: { current: BenchmarkState | null },
	config: DataConfig
): () => void {
	return () => {
		if (!stateRef.current) {
			const store = new OptimisticStore(benchmarkSchema, false, logger);
			const data = primeStoreWithData(store, config);
			stateRef.current = { store, data };
		}
	};
}

/**
 * Creates a teardown function for benchmarks
 */
function createTeardownFn(
	stateRef: { current: BenchmarkState | null },
	shouldClear: boolean = false
): () => void {
	return () => {
		if (shouldClear) {
			stateRef.current = null;
		}
	};
}

/**
 * Helper to create bench options with setup/teardown
 */
function withSetupTeardown(
	stateRef: { current: BenchmarkState | null },
	config: DataConfig
) {
	return {
		setup: createSetupFn(stateRef, config),
		teardown: createTeardownFn(stateRef, false),
	};
}

// ============================================================================
// QUERY PERFORMANCE BENCHMARKS
// ============================================================================

describe("websocket client - query performance", () => {
	describe("basic queries", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 5,
			usersPerOrg: 10,
			postsPerOrg: 10,
			commentsPerPost: 5,
		};

		beforeAll(() => {
			createSetupFn(stateRef, config)();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"shallow query - fetch all users",
			() => {
				stateRef.current!.store.get({ resource: "users" });
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"shallow query with where - single user by id",
			() => {
				stateRef.current!.store.get({
					resource: "users",
					where: { id: { $eq: stateRef.current!.data.userIds[0] } },
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"deep nested include - orgs with posts, comments, and authors",
			() => {
				stateRef.current!.store.get({
					resource: "orgs",
					include: {
						posts: {
							author: true,
							comments: {
								author: true,
							},
						},
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);
	});

	describe("filter clauses", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 10,
			usersPerOrg: 50,
			postsPerOrg: 50,
			commentsPerPost: 10,
		};

		beforeAll(() => {
			createSetupFn(stateRef, config)();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"where $eq - filter by exact id match",
			() => {
				stateRef.current!.store.get({
					resource: "users",
					where: { id: { $eq: stateRef.current!.data.userIds[0] } },
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"where $in - filter by id in array (50 ids)",
			() => {
				stateRef.current!.store.get({
					resource: "users",
					where: { id: { $in: stateRef.current!.data.userIds.slice(0, 50) } },
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"where range - filter 25 <= likes <= 75",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					where: {
						$and: [{ likes: { $gte: 25 } }, { likes: { $lte: 75 } }],
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"where $and - two conditions",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					where: {
						$and: [{ likes: { $gt: 25 } }, { likes: { $lt: 75 } }],
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"where $or - two conditions",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					where: {
						$or: [{ likes: { $lt: 10 } }, { likes: { $gt: 90 } }],
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"where + nested include - filter with deep relations",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					where: { likes: { $gte: 25 } },
					include: {
						author: true,
						comments: {
							author: true,
						},
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"where + sort + limit - filter, sort, take top 10",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					where: { likes: { $gt: 10 } },
					sort: [{ key: "likes", direction: "desc" }],
					limit: 10,
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"complex - where + include + sort + limit",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					where: {
						$and: [
							{ likes: { $gte: 20 } },
							{ orgId: { $in: stateRef.current!.data.orgIds.slice(0, 5) } },
						],
					},
					include: {
						author: true,
						org: true,
					},
					sort: [{ key: "likes", direction: "desc" }],
					limit: 25,
				});
			},
			withSetupTeardown(stateRef, config)
		);
	});

	describe("medium dataset (500 records)", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 10,
			usersPerOrg: 50,
			postsPerOrg: 50,
			commentsPerPost: 10,
		};

		beforeAll(() => {
			createSetupFn(stateRef, config)();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"shallow query - fetch all posts (500)",
			() => {
				stateRef.current!.store.get({ resource: "posts" });
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"deep nested - orgs with posts, comments, authors (10 orgs, 500 posts, 5000 comments)",
			() => {
				stateRef.current!.store.get({
					resource: "orgs",
					include: {
						posts: {
							author: true,
							comments: {
								author: true,
							},
						},
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);

		bench(
			"query with sort and limit - top 10 posts by likes",
			() => {
				stateRef.current!.store.get({
					resource: "posts",
					sort: [{ key: "likes", direction: "desc" }],
					limit: 10,
				});
			},
			withSetupTeardown(stateRef, config)
		);
	});

	describe("large dataset (2000+ records)", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 20,
			usersPerOrg: 100,
			postsPerOrg: 100,
			commentsPerPost: 10,
		};

		beforeAll(() => {
			createSetupFn(stateRef, config)();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"deep nested - orgs full tree (20 orgs, 2000 posts, 20000 comments)",
			() => {
				stateRef.current!.store.get({
					resource: "orgs",
					include: {
						posts: {
							author: true,
							comments: {
								author: true,
							},
						},
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);
	});
});

// ============================================================================
// MUTATION HANDLING BENCHMARKS
// ============================================================================

describe("websocket client - mutation handling", () => {
	describe("mutations", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 5,
			usersPerOrg: 10,
			postsPerOrg: 10,
			commentsPerPost: 5,
		};

		const setupFreshState = () => {
			const store = new OptimisticStore(benchmarkSchema, false, logger);
			const data = primeStoreWithData(store, config);
			stateRef.current = { store, data };
		};

		beforeAll(() => {
			setupFreshState();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"insert single post with relations",
			() => {
				const postId = generateId();
				stateRef.current!.store.addMutation(
					"posts",
					createMutation("posts", postId, {
						id: postId,
						title: "New Post",
						content: "New Content",
						orgId: stateRef.current!.data.orgIds[0],
						authorId: stateRef.current!.data.userIds[0],
						likes: 0,
					})
				);
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"update single field on user",
			() => {
				stateRef.current!.store.addMutation(
					"users",
					createMutation(
						"users",
						stateRef.current!.data.userIds[0],
						{ name: "Updated Name" },
						"UPDATE"
					)
				);
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"insert 100 comments sequentially",
			() => {
				for (let i = 0; i < 100; i++) {
					const commentId = generateId();
					stateRef.current!.store.addMutation(
						"comments",
						createMutation("comments", commentId, {
							id: commentId,
							content: `Bulk Comment ${i}`,
							postId:
								stateRef.current!.data.postIds[
									i % stateRef.current!.data.postIds.length
								],
							authorId:
								stateRef.current!.data.userIds[
									i % stateRef.current!.data.userIds.length
								],
						})
					);
				}
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);
	});

	describe("optimistic mutations", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 5,
			usersPerOrg: 10,
			postsPerOrg: 10,
			commentsPerPost: 5,
		};

		const setupFreshState = () => {
			const store = new OptimisticStore(benchmarkSchema, false, logger);
			const data = primeStoreWithData(store, config);
			stateRef.current = { store, data };
		};

		beforeAll(() => {
			setupFreshState();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"apply optimistic insert",
			() => {
				const commentId = generateId();
				stateRef.current!.store.addMutation(
					"comments",
					createMutation("comments", commentId, {
						id: commentId,
						content: "Optimistic Comment",
						postId: stateRef.current!.data.postIds[0],
						authorId: stateRef.current!.data.userIds[0],
					}),
					true
				);
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"undo optimistic mutation",
			() => {
				const commentId = generateId();
				const mutation = createMutation("comments", commentId, {
					id: commentId,
					content: "Optimistic Comment",
					postId: stateRef.current!.data.postIds[0],
					authorId: stateRef.current!.data.userIds[0],
				});
				stateRef.current!.store.addMutation("comments", mutation, true);
				stateRef.current!.store.undoMutation("comments", mutation.id);
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"confirm optimistic mutation (server confirmation)",
			() => {
				const commentId = generateId();
				const mutation = createMutation("comments", commentId, {
					id: commentId,
					content: "Optimistic Comment",
					postId: stateRef.current!.data.postIds[0],
					authorId: stateRef.current!.data.userIds[0],
				});
				stateRef.current!.store.addMutation("comments", mutation, true);
				stateRef.current!.store.addMutation("comments", mutation, false);
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);
	});
});

// ============================================================================
// SUBSCRIPTION NOTIFICATION BENCHMARKS
// ============================================================================

describe("websocket client - subscription notifications", () => {
	describe("subscription triggering on mutation", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 5,
			usersPerOrg: 10,
			postsPerOrg: 10,
			commentsPerPost: 5,
		};

		const setupFreshState = () => {
			const store = new OptimisticStore(benchmarkSchema, false, logger);
			const data = primeStoreWithData(store, config);
			stateRef.current = { store, data };
		};

		beforeAll(() => {
			setupFreshState();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"mutation with 10 active subscriptions",
			() => {
				const unsubscribes: (() => void)[] = [];
				for (let i = 0; i < 10; i++) {
					unsubscribes.push(
						stateRef.current!.store.subscribe({ resource: "comments" }, () => {})
					);
				}
				const commentId = generateId();
				stateRef.current!.store.addMutation(
					"comments",
					createMutation("comments", commentId, {
						id: commentId,
						content: "New Comment",
						postId: stateRef.current!.data.postIds[0],
						authorId: stateRef.current!.data.userIds[0],
					})
				);
				unsubscribes.forEach((u) => u());
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"mutation with deep nested include subscription",
			() => {
				const unsubscribe = stateRef.current!.store.subscribe(
					{
						resource: "orgs",
						include: {
							posts: {
								author: true,
								comments: {
									author: true,
								},
							},
						},
					},
					() => {}
				);
				const commentId = generateId();
				stateRef.current!.store.addMutation(
					"comments",
					createMutation("comments", commentId, {
						id: commentId,
						content: "New Comment",
						postId: stateRef.current!.data.postIds[0],
						authorId: stateRef.current!.data.userIds[0],
					})
				);
				unsubscribe();
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);
	});

	describe("subscription stress tests", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 10,
			usersPerOrg: 50,
			postsPerOrg: 50,
			commentsPerPost: 10,
		};

		const setupFreshState = () => {
			const store = new OptimisticStore(benchmarkSchema, false, logger);
			const data = primeStoreWithData(store, config);
			stateRef.current = { store, data };
		};

		beforeAll(() => {
			setupFreshState();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		const deepQueryWithWhere = () => ({
			resource: "orgs" as const,
			where: {
				$or: [
					{ name: { $eq: "Organization 0" } },
					{ name: { $eq: "Organization 5" } },
				],
			},
			include: {
				posts: {
					author: true,
					comments: {
						author: true,
					},
				},
			},
		});

		const createUniqueDeepQuery = (index: number) => ({
			resource: "posts" as const,
			where: {
				$and: [
					{ likes: { $gte: index % 50 } },
					{ likes: { $lte: (index % 50) + 50 } },
					{
						orgId: {
							$in: [
								stateRef.current!.data.orgIds[index % stateRef.current!.data.orgIds.length],
								stateRef.current!.data.orgIds[(index + 1) % stateRef.current!.data.orgIds.length],
							],
						},
					},
				],
			},
			include: {
				author: true,
				org: true,
				comments: {
					author: true,
				},
			},
		});

		bench(
			"100 equal deep subscriptions + mutation",
			() => {
				const unsubscribes: (() => void)[] = [];
				for (let i = 0; i < 100; i++) {
					unsubscribes.push(
						stateRef.current!.store.subscribe(deepQueryWithWhere(), () => {})
					);
				}
				const commentId = generateId();
				stateRef.current!.store.addMutation(
					"comments",
					createMutation("comments", commentId, {
						id: commentId,
						content: "New Comment",
						postId: stateRef.current!.data.postIds[0],
						authorId: stateRef.current!.data.userIds[0],
					})
				);
				unsubscribes.forEach((u) => u());
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"100 different deep subscriptions + mutation",
			() => {
				const unsubscribes: (() => void)[] = [];
				for (let i = 0; i < 100; i++) {
					unsubscribes.push(
						stateRef.current!.store.subscribe(createUniqueDeepQuery(i), () => {})
					);
				}
				const commentId = generateId();
				stateRef.current!.store.addMutation(
					"comments",
					createMutation("comments", commentId, {
						id: commentId,
						content: "New Comment",
						postId: stateRef.current!.data.postIds[0],
						authorId: stateRef.current!.data.userIds[0],
					})
				);
				unsubscribes.forEach((u) => u());
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);

		bench(
			"100 subscriptions + 20 sequential mutations",
			() => {
				const unsubscribes: (() => void)[] = [];
				for (let i = 0; i < 100; i++) {
					unsubscribes.push(
						stateRef.current!.store.subscribe(deepQueryWithWhere(), () => {})
					);
				}
				for (let m = 0; m < 20; m++) {
					const commentId = generateId();
					stateRef.current!.store.addMutation(
						"comments",
						createMutation("comments", commentId, {
							id: commentId,
							content: `New Comment ${m}`,
							postId: stateRef.current!.data.postIds[m % stateRef.current!.data.postIds.length],
							authorId: stateRef.current!.data.userIds[m % stateRef.current!.data.userIds.length],
						})
					);
				}
				unsubscribes.forEach((u) => u());
			},
			{
				setup: setupFreshState,
				teardown: () => {},
			}
		);
	});
});

// ============================================================================
// CONSOLIDATED STATE LOADING BENCHMARKS
// ============================================================================

describe("websocket client - consolidated state loading", () => {
	describe("loadConsolidatedState performance", () => {
		const stateRef: { current: { store: OptimisticStore } | null } = {
			current: null,
		};

		const setupFreshStore = () => {
			stateRef.current = {
				store: new OptimisticStore(benchmarkSchema, false, logger),
			};
		};

		beforeAll(() => {
			setupFreshStore();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"load 100 users",
			() => {
				const users = Array.from({ length: 100 }, (_, i) => ({
					id: { value: generateId() },
					name: { value: `User ${i}` },
					email: { value: `user${i}@example.com` },
				}));
				stateRef.current!.store.loadConsolidatedState("users", users);
			},
			{
				setup: setupFreshStore,
				teardown: () => {},
			}
		);

		bench(
			"load 1000 users",
			() => {
				const users = Array.from({ length: 1000 }, (_, i) => ({
					id: { value: generateId() },
					name: { value: `User ${i}` },
					email: { value: `user${i}@example.com` },
				}));
				stateRef.current!.store.loadConsolidatedState("users", users);
			},
			{
				setup: setupFreshStore,
				teardown: () => {},
			}
		);
	});
});

// ============================================================================
// OBJECT GRAPH PERFORMANCE BENCHMARKS
// ============================================================================

describe("websocket client - object graph operations", () => {
	describe("graph traversal during queries", () => {
		const stateRef: { current: BenchmarkState | null } = { current: null };
		const config: DataConfig = {
			orgs: 10,
			usersPerOrg: 50,
			postsPerOrg: 50,
			commentsPerPost: 20,
		};

		beforeAll(() => {
			createSetupFn(stateRef, config)();
		});

		afterAll(() => {
			stateRef.current = null;
		});

		bench(
			"traverse full graph depth (org -> posts -> comments -> author)",
			() => {
				stateRef.current!.store.get({
					resource: "orgs",
					include: {
						posts: {
							author: true,
							comments: {
								author: true,
							},
						},
					},
				});
			},
			withSetupTeardown(stateRef, config)
		);
	});
});
