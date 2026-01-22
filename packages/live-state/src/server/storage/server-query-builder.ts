/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */

import { QueryBuilder, type QueryExecutor } from '../../core/query';
import type { RawQueryRequest } from '../../core/schemas/core-protocol';
import type {
  InferInsert,
  InferLiveCollection,
  InferUpdate,
  LiveCollectionAny,
  LiveTypeAny,
  MaterializedLiveType,
  Schema,
} from '../../schema';
import { inferValue } from '../../schema';
import type { Simplify } from '../../utils';
import type { Storage } from './interface';

const isMaterializedLiveType = (
	value: unknown,
): value is MaterializedLiveType<LiveTypeAny> => {
	return (
		typeof value === 'object' &&
		value !== null &&
		'value' in value &&
		!Array.isArray(value)
	);
};

/**
 * Server-side query executor that wraps Storage.get() and always returns Promises.
 * @internal
 */
class ServerQueryExecutor implements QueryExecutor {
	constructor(private storage: Storage) {}

	get(query: RawQueryRequest): Promise<any[]> {
		return Promise.resolve(this.storage.get(query)).then((result) =>
			result.map((item) =>
				isMaterializedLiveType(item) ? inferValue(item) : item,
			),
		);
	}

	subscribe(): () => void {
		throw new Error(
			'Subscriptions are not supported server-side. Use .get() instead.',
		);
	}
}

/**
 * A QueryBuilder with added insert() and update() mutation methods for server-side use.
 */
export type ServerCollection<T extends LiveCollectionAny> = QueryBuilder<
	T,
	{},
	false,
	true
> & {
	/**
	 * Insert a new record into this collection.
	 */
	insert(value: Simplify<InferInsert<T>>): Promise<InferLiveCollection<T>>;

	/**
	 * Update an existing record in this collection.
	 */
	update(
		id: string,
		value: InferUpdate<T>,
	): Promise<Partial<InferLiveCollection<T>>>;
};

/**
 * Server database interface that provides collection properties and deprecated methods.
 * Each collection property (e.g., db.users, db.posts) is a ServerCollection with
 * QueryBuilder methods plus insert/update mutations.
 */
export type ServerDB<TSchema extends Schema<any>> = {
	[K in keyof TSchema]: ServerCollection<TSchema[K]>;
} & {
	/**
	 * @deprecated Use db.[collection].one(id).get() instead
	 */
	findOne: Storage['findOne'];

	/**
	 * @deprecated Use db.[collection].where({...}).get() instead
	 */
	find: Storage['find'];

	/**
	 * @deprecated Use db.[collection].insert({...}) instead
	 */
	insert: Storage['insert'];

	/**
	 * @deprecated Use db.[collection].update(id, {...}) instead
	 */
	update: Storage['update'];

	/**
	 * Execute operations within a transaction.
	 * The transaction wrapper provides a ServerDB interface for the transaction.
	 */
	transaction: <T>(
		fn: (opts: {
			trx: ServerDB<TSchema>;
			commit: () => Promise<void>;
			rollback: () => Promise<void>;
		}) => Promise<T>,
	) => Promise<T>;
};

/**
 * Creates a ServerDB proxy that wraps a Storage instance with QueryBuilder-based syntax.
 *
 * @example
 * ```typescript
 * const db = createServerDB(storage, schema);
 *
 * // New syntax
 * const user = await db.users.one(userId).get();
 * const posts = await db.posts.where({ authorId: userId }).limit(10).get();
 * await db.users.insert({ id: '...', name: '...' });
 *
 * // Deprecated syntax (still works)
 * const user = await db.findOne(schema.users, userId);
 * const posts = await db.find(schema.posts, { where: { authorId: userId }, limit: 10 });
 * ```
 */
export function createServerDB<TSchema extends Schema<any>>(
	storage: Storage,
	schema: TSchema,
): ServerDB<TSchema> {
	const executor = new ServerQueryExecutor(storage);

	const createCollection = <T extends LiveCollectionAny>(
		resourceSchema: T,
	): ServerCollection<T> => {
		const queryBuilder = QueryBuilder._init(resourceSchema, executor, true);

		const collection = Object.assign(Object.create(queryBuilder), {
			insert: (value: Simplify<InferInsert<T>>) =>
				storage.insert(resourceSchema, value),

			update: (id: string, value: InferUpdate<T>) =>
				storage.update(resourceSchema, id, value),
		}) as ServerCollection<T>;

		return collection;
	};

	const handler: ProxyHandler<object> = {
		get(_target, prop: string) {
			// Handle deprecated Storage methods
			if (prop === 'findOne') {
				return storage.findOne.bind(storage);
			}
			if (prop === 'find') {
				return storage.find.bind(storage);
			}
			if (prop === 'insert') {
				return storage.insert.bind(storage);
			}
			if (prop === 'update') {
				return storage.update.bind(storage);
			}

			// Handle transaction
			if (prop === 'transaction') {
				return async <T>(
					fn: (opts: {
						trx: ServerDB<TSchema>;
						commit: () => Promise<void>;
						rollback: () => Promise<void>;
					}) => Promise<T>,
				): Promise<T> => {
					return storage.transaction(async ({ trx, commit, rollback }) => {
						const trxDB = createServerDB(trx, schema);
						return fn({ trx: trxDB, commit, rollback });
					});
				};
			}

			// Handle collection access (e.g., db.users, db.posts)
			if (prop in schema) {
				const resourceSchema = schema[prop];
				return createCollection(resourceSchema);
			}

			return undefined;
		},
	};

	return new Proxy({}, handler) as ServerDB<TSchema>;
}
