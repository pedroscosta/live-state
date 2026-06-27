/** biome-ignore-all lint/suspicious/noExplicitAny: any's are actually used correctly */
import { QueryEngine } from '../core/query-engine';
import type { RawQueryRequest, SyncDelta } from '../core/schemas/core-protocol';
import type { PromiseOrSync } from '../core/utils';
import { inferValue, type Schema, type WhereClause } from '../schema';
import { createLogger, type Logger, LogLevel } from '../utils';
import { type Hooks, type HooksRegistry, mergeEntityHooks } from './hooks';
import type { AnyRoute, AnyRouter, QueryProcedureRequest } from './router';
import type { Storage } from './storage';

export * from './adapters/express';
export * from './hooks';
export * from './router';
export * from './storage';

export type { QueryProcedureRequest };

export interface BaseRequest<TContext = Record<string, any>> {
	headers: Record<string, string>;
	cookies: Record<string, string>;
	queryParams: Record<string, string>;
	context: TContext;
}

export interface QueryRequest<TContext = Record<string, any>>
	extends BaseRequest<TContext>,
		RawQueryRequest {
	type: 'QUERY';
	/** @internal */
	relationalWhere?: WhereClause<any>;
}

export interface MutationRequest<TInput = any, TContext = Record<string, any>>
	extends BaseRequest<TContext> {
	type: 'MUTATE';
	input: TInput;
	resource: string;
	resourceId?: string;
	procedure: string;
	/** @internal */
	meta?: { timestamp?: string };
}

export type Request<TContext = Record<string, any>> =
	| QueryRequest<TContext>
	| MutationRequest<any, TContext>
	| QueryProcedureRequest<any, TContext>;

export type ContextProvider<TContext = Record<string, any>> = (
	req: Omit<BaseRequest, 'context'> & {
		transport: 'HTTP' | 'WEBSOCKET';
	},
) => TContext | Promise<TContext>;

export type NextFunction<O, R = Request> = (req: R) => PromiseOrSync<O>;

export type Middleware<T = any> = (opts: {
	req: Request;
	next: NextFunction<T>;
}) => ReturnType<NextFunction<T>>;

export class Server<TRouter extends AnyRouter, TContext = Record<string, any>> {
	readonly router: TRouter;
	readonly storage: Storage;
	readonly schema: Schema<any>;
	readonly middlewares: Set<Middleware<any>> = new Set();
	readonly logger: Logger;
	readonly hooksRegistry: Map<string, Hooks<any, any, any>> = new Map();
	private readonly initPromise: Promise<void>;
	private initError?: unknown;

	contextProvider?: ContextProvider<TContext>;

	/** @internal */
	readonly queryEngine: QueryEngine;

	private constructor(opts: {
		router: TRouter;
		storage: Storage;
		schema: Schema<any>;
		middlewares?: Middleware<any>[];
		contextProvider?: ContextProvider<TContext>;
		hooks?: HooksRegistry<any, TContext>;
		logLevel?: LogLevel;
	}) {
		this.router = opts.router;
		this.storage = opts.storage;
		this.schema = opts.schema;
		this.logger = createLogger({
			level: opts.logLevel ?? LogLevel.INFO,
		});
		opts.middlewares?.forEach((middleware) => {
			this.middlewares.add(middleware);
		});

		if (opts.hooks) {
			for (const [key, entityHooks] of Object.entries(opts.hooks)) {
				const merged = mergeEntityHooks([
					entityHooks as Hooks<any, any, any> | undefined,
				]);
				if (merged) this.hooksRegistry.set(key, merged);
			}
		}

		this.initPromise = this.storage
			.init(this.schema, this.logger, this)
			.catch((error) => {
				this.initError = error;
			});
		this.contextProvider = opts.contextProvider;

		// Tracked Queries resolve in a single `storage.get` (storage owns `include`
		// resolution); the engine only matches committed writes and broadcasts
		// Sync Deltas to subscribers. See ADR-0003.
		this.queryEngine = new QueryEngine({
			storage: this.storage,
			schema: this.schema,
			logger: this.logger,
		});
	}

	public static create<TRouter extends AnyRouter, TContext>(opts: {
		router: TRouter;
		storage: Storage;
		schema: Schema<any>;
		middlewares?: Middleware<any>[];
		contextProvider: ContextProvider<TContext>;
		hooks?: HooksRegistry<any, TContext>;
		logLevel?: LogLevel;
	}): Server<TRouter, TContext>;
	public static create<TRouter extends AnyRouter>(opts: {
		router: TRouter;
		storage: Storage;
		schema: Schema<any>;
		middlewares?: Middleware<any>[];
		hooks?: HooksRegistry<any, Record<string, any>>;
		logLevel?: LogLevel;
	}): Server<TRouter, Record<string, any>>;
	public static create<
		TRouter extends AnyRouter,
		TContext = Record<string, any>,
	>(opts: {
		router: TRouter;
		storage: Storage;
		schema: Schema<any>;
		middlewares?: Middleware<any>[];
		contextProvider?: ContextProvider<TContext>;
		hooks?: HooksRegistry<any, TContext>;
		logLevel?: LogLevel;
	}) {
		return new Server<TRouter, TContext>(opts);
	}

	public getHooks(resourceName: string): Hooks<any, any, any> | undefined {
		return this.hooksRegistry.get(resourceName);
	}

	public async handleMutation(opts: { req: MutationRequest }): Promise<any> {
		await this.ensureInitialized();

		const result = await this.wrapInMiddlewares(
			async (req: MutationRequest) => {
				const route = this.router.routes[req.resource] as AnyRoute | undefined;

				if (!route) {
					throw new Error('Invalid resource');
				}

				return route.handleMutation({
					req,
					db: this.storage,
					schema: this.schema,
				});
			},
		)(opts.req);

		return result;
	}

	public async handleCustomQuery(opts: {
		req: QueryProcedureRequest;
		subscription?: (mutation: SyncDelta) => void;
	}): Promise<any> {
		await this.ensureInitialized();

		const result = await this.wrapInMiddlewares(
			async (req: QueryProcedureRequest) => {
				const route = this.router.routes[req.resource] as AnyRoute | undefined;

				if (!route) {
					throw new Error('Invalid resource');
				}

				return route.handleCustomQuery({
					req,
					db: this.storage,
					schema: this.schema,
				});
			},
		)(opts.req);

		const isQueryBuilder =
			typeof result === 'object' &&
			result !== null &&
			'buildQueryRequest' in result &&
			typeof (result as { buildQueryRequest?: unknown }).buildQueryRequest ===
				'function';

		if (!isQueryBuilder) {
			if (opts.subscription) {
				throw new Error(
					'Subscriptions require custom queries to return a QueryBuilder',
				);
			}
			return result;
		}

		const { headers, cookies, queryParams, context } = opts.req;
		const ctx = { headers, cookies, queryParams, context };
		const rawQuery = (
			result as { buildQueryRequest: () => RawQueryRequest }
		).buildQueryRequest();

		const unsubscribe = opts.subscription
			? this.queryEngine.subscribe(
					rawQuery,
					(mutation) => {
						opts.subscription?.(mutation);
					},
					ctx,
				)
			: undefined;

		const data = await this.queryEngine.get(rawQuery, {
			context: ctx,
		});

		if (opts.subscription) {
			return { data, unsubscribe, query: rawQuery };
		}

		return data.map((item) => inferValue(item));
	}

	public use(middleware: Middleware<any>) {
		this.middlewares.add(middleware);
		return this;
	}

	public context(contextProvider: ContextProvider<TContext>) {
		this.contextProvider = contextProvider;
		return this;
	}

	/** @internal */
	public notifySubscribers(mutation: SyncDelta, entityData: any) {
		this.queryEngine.handleMutation(mutation, entityData);
	}

	private wrapInMiddlewares<T extends Request>(
		next: NextFunction<any, T>,
	): NextFunction<any, T> {
		return (req: T) =>
			Array.from(this.middlewares.values()).reduceRight(
				(next, middleware) => (req) =>
					middleware({ req, next: next as NextFunction<any, any> }),
				next,
			)(req);
	}

	private async ensureInitialized(): Promise<void> {
		await this.initPromise;

		if (this.initError) {
			throw this.initError;
		}
	}
}

export const server = Server.create;
