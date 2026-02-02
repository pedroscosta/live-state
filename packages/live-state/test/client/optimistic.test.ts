import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, test, vi } from 'vitest';
import {
	createOptimisticStorageProxy,
	defineOptimisticMutations,
} from '../../src/client/optimistic';
import {
	createRelations,
	createSchema,
	id,
	number,
	object,
	string,
} from '../../src/schema';

const users = object('users', {
	id: id(),
	name: string(),
	age: number(),
	postCount: number().default(0),
});

const posts = object('posts', {
	id: id(),
	title: string(),
	content: string(),
	likes: number().default(0),
	views: number().default(0),
	authorId: string(),
	ownerId: string(),
});

const userRelations = createRelations(users, ({ many }) => ({
	posts: many(posts, 'authorId'),
}));

const postRelations = createRelations(posts, ({ one }) => ({
	author: one(users, 'authorId'),
	owner: one(users, 'ownerId'),
}));

const schema = createSchema({
	users,
	userRelations,
	posts,
	postRelations,
});

type TestRouter = {
	routes: {
		posts: {
			resourceSchema: typeof posts;
			customMutations: {
				incrementLikes: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<any, { postId: string }>;
					handler: () => void;
				};
				createPost: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<
						any,
						{ id: string; title: string; content: string }
					>;
					handler: () => void;
				};
				transferOwnership: {
					_type: 'mutation';
					inputValidator: StandardSchemaV1<
						any,
						{ postId: string; newOwnerId: string }
					>;
					handler: () => void;
				};
			};
			customQueries: {};
		};
		users: {
			resourceSchema: typeof users;
			customMutations: {};
			customQueries: {};
		};
	};
};

const createMockStore = (responses: Record<string, unknown[]>) => ({
	get: vi.fn(
		(query: {
			resource: string;
			where?: Record<string, unknown>;
			limit?: number;
		}) => {
			const items = responses[query.resource] ?? [];
			const filtered = query.where
				? items.filter((item) => {
						if (typeof item !== "object" || item === null) return false;
						return Object.entries(query.where ?? {}).every(
							([key, value]) =>
								(item as Record<string, unknown>)[key] === value
						);
					})
				: items;

			return typeof query.limit === "number"
				? filtered.slice(0, query.limit)
				: filtered;
		}
	),
	schema,
});

describe('client-side optimistic mutations', () => {
	test('declares handlers upfront and resolves them by route/procedure', () => {
		const registry = defineOptimisticMutations<TestRouter, typeof schema>({
			posts: {
				incrementLikes: vi.fn(),
			},
		});

		expect(registry.getHandler('posts', 'incrementLikes')).toBeDefined();
		expect(registry.getHandler('posts', 'missing')).toBeUndefined();
		expect(registry.getHandler('missing', 'incrementLikes')).toBeUndefined();
	});

	test('ignores invalid or empty handlers in the registry', () => {
		const registry = defineOptimisticMutations<TestRouter, typeof schema>({
			posts: {
				incrementLikes: undefined as any,
				createPost: 'nope' as any,
			},
			users: undefined,
		});

		expect(registry.getHandler('posts', 'incrementLikes')).toBeUndefined();
		expect(registry.getHandler('posts', 'createPost')).toBeUndefined();
	});

	test('reads optimistic state and registers a reversible update', () => {
		const store = createMockStore({
			posts: [{ id: 'post-1', likes: 2 }],
		});
		const { proxy, getOperations } = createOptimisticStorageProxy(
			store as any,
			schema
		);

		const handler = ({ input, storage }: { input: { postId: string }; storage: any }) => {
			const post = storage.posts.one(input.postId).get();
			if (!post) return;
			storage.posts.update(input.postId, { likes: post.likes + 1 });
		};

		handler({ input: { postId: 'post-1' }, storage: proxy });

		const operations = getOperations();
		expect(operations).toHaveLength(1);
		expect(operations[0]).toEqual(
			expect.objectContaining({
				type: 'update',
				resource: 'posts',
				id: 'post-1',
				data: { likes: 3 },
			})
		);
	});

	test('returns undefined when a single record is missing', () => {
		const store = createMockStore({
			posts: [],
		});
		const { proxy } = createOptimisticStorageProxy(store as any, schema);

		const result = proxy.posts.one('post-404').get();

		expect(result).toBeUndefined();
		expect(store.get).toHaveBeenCalledWith(
			expect.objectContaining({
				resource: 'posts',
				where: { id: 'post-404' },
				limit: 1,
			})
		);
	});

	test('forwards include clauses for one and where queries', () => {
		const store = createMockStore({
			posts: [{ id: 'post-1', authorId: 'user-1' }],
			users: [{ id: 'user-1', name: 'Ada', age: 42 }],
		});
		const { proxy } = createOptimisticStorageProxy(store as any, schema);

		const oneResult = proxy.posts
			.one('post-1')
			.include({ author: true })
			.get();
		const whereResult = proxy.posts
			.where({ authorId: 'user-1' })
			.include({ author: { profile: true } })
			.get();

		expect(oneResult).toEqual(expect.objectContaining({ id: 'post-1' }));
		expect(whereResult).toHaveLength(1);
		expect(store.get).toHaveBeenCalledWith(
			expect.objectContaining({
				resource: 'posts',
				where: { id: 'post-1' },
				include: { author: true },
				limit: 1,
			})
		);
		expect(store.get).toHaveBeenCalledWith(
			expect.objectContaining({
				resource: 'posts',
				where: { authorId: 'user-1' },
				include: { author: { profile: true } },
			})
		);
	});

	test('registers insert and multiple updates from one handler', () => {
		const store = createMockStore({
			posts: [{ id: 'post-1', ownerId: 'user-1' }],
			users: [
				{ id: 'user-1', postCount: 1 },
				{ id: 'user-2', postCount: 3 },
			],
		});
		const { proxy, getOperations } = createOptimisticStorageProxy(
			store as any,
			schema
		);

		const createPost = ({
			input,
			storage,
		}: {
			input: { id: string; title: string; content: string };
			storage: any;
		}) => {
			storage.posts.insert({
				id: input.id,
				title: input.title,
				content: input.content,
				authorId: 'user-1',
				ownerId: 'user-1',
			});
		};

		const transferOwnership = ({
			input,
			storage,
		}: {
			input: { postId: string; newOwnerId: string };
			storage: any;
		}) => {
			const post = storage.posts.one(input.postId).get();
			if (!post) return;
			const currentOwner = storage.users.one(post.ownerId).get();
			const newOwner = storage.users.one(input.newOwnerId).get();
			if (!currentOwner || !newOwner) return;

			storage.posts.update(input.postId, { ownerId: input.newOwnerId });
			storage.users.update(input.newOwnerId, {
				postCount: newOwner.postCount + 1,
			});
			storage.users.update(post.ownerId, {
				postCount: currentOwner.postCount - 1,
			});
		};

		createPost({
			input: { id: 'post-2', title: 'Hello', content: 'World' },
			storage: proxy,
		});
		transferOwnership({
			input: { postId: 'post-1', newOwnerId: 'user-2' },
			storage: proxy,
		});

		const operations = getOperations();
		expect(operations).toHaveLength(4);
		expect(operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'insert',
					resource: 'posts',
					id: 'post-2',
					data: expect.objectContaining({ title: 'Hello', content: 'World' }),
				}),
				expect.objectContaining({
					type: 'update',
					resource: 'posts',
					id: 'post-1',
					data: { ownerId: 'user-2' },
				}),
				expect.objectContaining({
					type: 'update',
					resource: 'users',
					id: 'user-2',
					data: { postCount: 4 },
				}),
				expect.objectContaining({
					type: 'update',
					resource: 'users',
					id: 'user-1',
					data: { postCount: 0 },
				}),
			])
		);

		expect((operations[0] as any).data).not.toHaveProperty('id');
	});

	test('does not register operations when handler short-circuits', () => {
		const store = createMockStore({
			posts: [{ id: 'post-1', ownerId: 'user-1' }],
			users: [{ id: 'user-1', postCount: 1 }],
		});
		const { proxy, getOperations } = createOptimisticStorageProxy(
			store as any,
			schema
		);

		const handler = ({
			input,
			storage,
		}: {
			input: { postId: string; newOwnerId: string };
			storage: any;
		}) => {
			const post = storage.posts.one(input.postId).get();
			if (!post) return;
			const newOwner = storage.users.one(input.newOwnerId).get();
			if (!newOwner) return;
			storage.posts.update(input.postId, { ownerId: input.newOwnerId });
		};

		handler({ input: { postId: 'post-404', newOwnerId: 'user-2' }, storage: proxy });
		handler({ input: { postId: 'post-1', newOwnerId: 'user-2' }, storage: proxy });

		expect(getOperations()).toHaveLength(0);
	});

	test('registers updates derived from a query result', () => {
		const store = createMockStore({
			posts: [
				{ id: 'post-1', views: 1, authorId: 'user-1' },
				{ id: 'post-2', views: 5, authorId: 'user-1' },
			],
		});
		const { proxy, getOperations } = createOptimisticStorageProxy(
			store as any,
			schema
		);

		const handler = ({
			input,
			storage,
		}: {
			input: { authorId: string };
			storage: any;
		}) => {
			const postsToUpdate = storage.posts.where({ authorId: input.authorId }).get();
			postsToUpdate.forEach((post: { id: string; views: number }) => {
				storage.posts.update(post.id, { views: post.views + 1 });
			});
		};

		handler({ input: { authorId: 'user-1' }, storage: proxy });

		const operations = getOperations();
		expect(operations).toHaveLength(2);
		expect(operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'update',
					resource: 'posts',
					id: 'post-1',
					data: { views: 2 },
				}),
				expect.objectContaining({
					type: 'update',
					resource: 'posts',
					id: 'post-2',
					data: { views: 6 },
				}),
			])
		);
	});

	test('accumulates operations in order across multiple handlers', () => {
		const store = createMockStore({
			posts: [{ id: 'post-1', likes: 1 }],
		});
		const { proxy, getOperations } = createOptimisticStorageProxy(
			store as any,
			schema
		);

		const likePost = (storage: any) => {
			const post = storage.posts.one('post-1').get();
			if (!post) return;
			storage.posts.update('post-1', { likes: post.likes + 1 });
		};

		const createPost = (storage: any) => {
			storage.posts.insert({
				id: 'post-2',
				title: 'New',
				content: 'Post',
				authorId: 'user-1',
				ownerId: 'user-1',
			});
		};

		likePost(proxy);
		createPost(proxy);

		const operations = getOperations();
		expect(operations).toHaveLength(2);
		expect(operations[0]).toEqual(
			expect.objectContaining({
				type: 'update',
				resource: 'posts',
				id: 'post-1',
			})
		);
		expect(operations[1]).toEqual(
			expect.objectContaining({
				type: 'insert',
				resource: 'posts',
				id: 'post-2',
			})
		);
	});

	test('returns undefined for unknown resources on the proxy', () => {
		const store = createMockStore({
			posts: [],
		});
		const { proxy } = createOptimisticStorageProxy(store as any, schema);

		expect((proxy as any).missing).toBeUndefined();
	});
});
