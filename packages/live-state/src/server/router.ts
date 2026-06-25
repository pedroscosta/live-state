/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
/** biome-ignore-all lint/style/noNonNullAssertion: false positive */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';
import { type Schema } from '../schema';
import type {
	BaseRequest,
	Middleware,
	MutationRequest,
	NextFunction,
	Request,
	Storage,
} from '.';
import { createServerDB, type ServerDB } from './storage/server-query-builder';

export type AnyRoute = Route<
	Middleware<any>,
	Record<string, any>,
	Record<string, any>,
	any,
	any
>;
export type RouteRecord = Record<string, AnyRoute>;

export class Router<
	TRoutes extends RouteRecord,
	TSchema extends Schema<any> = Schema<any>,
> {
	readonly routes: TRoutes;
	readonly schema: TSchema;

	private constructor(opts: { routes: TRoutes; schema: TSchema }) {
		this.routes = opts.routes;
		this.schema = opts.schema;
	}

	public static create<
		TRoutes extends RouteRecord,
		TSchema extends Schema<any>,
	>(opts: { routes: TRoutes; schema: TSchema }) {
		return new Router<TRoutes, TSchema>(opts);
	}
}

export const router = <
	TSchema extends Schema<any>,
	TRoutes extends RouteRecord,
>(opts: {
	schema: TSchema;
	routes: TRoutes;
}) => Router.create<TRoutes, TSchema>(opts);

export type AnyRouter = Router<any, any>;

export type Mutation<
	TInputValidator extends StandardSchemaV1<any, any> | never,
	TOutput,
	TContext = Record<string, any>,
> = {
	_type: 'mutation';
	inputValidator: TInputValidator;
	handler: (opts: {
		req: MutationRequest<
			TInputValidator extends StandardSchemaV1<any, any>
				? StandardSchemaV1.InferOutput<TInputValidator>
				: undefined,
			TContext
		>;
		db: ServerDB<any>;
	}) => TOutput;
};

export interface QueryProcedureRequest<
	TInput = any,
	TContext = Record<string, any>,
> extends BaseRequest<TContext> {
	type: 'CUSTOM_QUERY';
	input: TInput;
	resource: string;
	procedure: string;
}

export type Query<
	TInputValidator extends StandardSchemaV1<any, any> | never,
	TOutput,
	TContext = Record<string, any>,
> = {
	_type: 'query';
	inputValidator: TInputValidator;
	handler: (opts: {
		req: QueryProcedureRequest<
			TInputValidator extends StandardSchemaV1<any, any>
				? StandardSchemaV1.InferOutput<TInputValidator>
				: undefined,
			TContext
		>;
		db: ServerDB<any>;
	}) => TOutput;
};

export type Procedure<
	TInputValidator extends StandardSchemaV1<any, any> | never,
	TOutput,
	TContext = Record<string, any>,
> =
	| Mutation<TInputValidator, TOutput, TContext>
	| Query<TInputValidator, TOutput, TContext>;

type QueryCreator<
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = {
	(): {
		handler: <TOutput>(
			handler: (opts: {
				req: QueryProcedureRequest<undefined, TContext>;
				db: ServerDB<TSchema>;
			}) => TOutput,
		) => Query<StandardSchemaV1<any, undefined>, TOutput, TContext>;
	};
	<TInputValidator extends StandardSchemaV1<any, any>>(
		validator: TInputValidator,
	): {
		handler: <
			THandler extends (opts: {
				req: QueryProcedureRequest<
					StandardSchemaV1.InferOutput<TInputValidator>,
					TContext
				>;
				db: ServerDB<TSchema>;
			}) => any,
		>(
			handler: THandler,
		) => Query<TInputValidator, ReturnType<THandler>, TContext>;
	};
};

const queryCreator = (<TInputValidator extends StandardSchemaV1<any, any>>(
	validator?: TInputValidator,
) => {
	return {
		handler: <THandler extends Query<TInputValidator, any>['handler']>(
			handler: THandler,
		) =>
			({
				_type: 'query',
				inputValidator:
					validator ?? (z.undefined() as StandardSchemaV1<any, undefined>),
				handler,
			}) as Query<TInputValidator, ReturnType<THandler>>,
	};
}) as QueryCreator;

type MutationCreator<
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> = {
	(): {
		handler: <TOutput>(
			handler: (opts: {
				req: MutationRequest<undefined, TContext>;
				db: ServerDB<TSchema>;
			}) => TOutput,
		) => Mutation<StandardSchemaV1<any, undefined>, TOutput, TContext>;
	};
	<TInputValidator extends StandardSchemaV1<any, any>>(
		validator: TInputValidator,
	): {
		handler: <
			THandler extends (opts: {
				req: MutationRequest<
					StandardSchemaV1.InferOutput<TInputValidator>,
					TContext
				>;
				db: ServerDB<TSchema>;
			}) => any,
		>(
			handler: THandler,
		) => Mutation<TInputValidator, ReturnType<THandler>, TContext>;
	};
};

const mutationCreator = (<TInputValidator extends StandardSchemaV1<any, any>>(
	validator?: TInputValidator,
) => {
	return {
		handler: <THandler extends Mutation<TInputValidator, any>['handler']>(
			handler: THandler,
		) =>
			({
				_type: 'mutation',
				inputValidator:
					validator ?? (z.undefined() as StandardSchemaV1<any, undefined>),
				handler,
			}) as Mutation<TInputValidator, ReturnType<THandler>>,
	};
}) as MutationCreator;

export class Route<
	TMiddleware extends Middleware<any>,
	TCustomMutations extends Record<string, Mutation<any, any>>,
	TCustomQueries extends Record<string, Query<any, any>>,
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> {
	readonly middlewares: Set<TMiddleware>;
	readonly customMutations: TCustomMutations;
	readonly customQueries: TCustomQueries;

	public constructor(
		customMutations?: TCustomMutations,
		customQueries?: TCustomQueries,
	) {
		this.middlewares = new Set();
		this.customMutations = customMutations ?? ({} as TCustomMutations);
		this.customQueries = customQueries ?? ({} as TCustomQueries);
	}

	public use(...middlewares: TMiddleware[]) {
		for (const middleware of middlewares) {
			this.middlewares.add(middleware);
		}
		return this;
	}

	/** @internal */
	public handleMutation = async ({
		req,
		db,
		schema,
	}: {
		req: MutationRequest;
		db: Storage;
		schema: Schema<any>;
	}): Promise<any> => {
		const mutationTimestamp = req.meta?.timestamp ?? new Date().toISOString();
		const mutationDb = db._setMutationTimestamp(mutationTimestamp);

		const serverDB = createServerDB(mutationDb, schema, req.context);

		return await this.wrapInMiddlewares(async (req: MutationRequest) => {
			if (!req.procedure)
				throw new Error('Procedure is required for mutations');

			const customProcedure = this.customMutations[req.procedure];

			if (customProcedure) {
				const validationResult = customProcedure.inputValidator[
					'~standard'
				].validate(req.input);

				const result =
					validationResult instanceof Promise
						? await validationResult
						: validationResult;

				if (result.issues) {
					const errorMessage = result.issues
						.map(
							(issue: {
								message: string;
								path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
							}) => {
								const path = issue.path
									?.map((p) =>
										typeof p === 'object' && 'key' in p
											? String(p.key)
											: String(p),
									)
									.join('.');
								return path ? `${path}: ${issue.message}` : issue.message;
							},
						)
						.join(', ');
					throw new Error(`Validation failed: ${errorMessage}`);
				}

				req.input = result.value;

				return customProcedure.handler({
					req,
					db: serverDB,
				});
			}

			throw new Error(`Unknown procedure: ${req.procedure}`);
		})(req);
	};

	/** @internal */
	public handleCustomQuery = async ({
		req,
		db,
		schema,
	}: {
		req: QueryProcedureRequest;
		db: Storage;
		schema: Schema<any>;
	}): Promise<any> => {
		const serverDB = createServerDB(db, schema, req.context);

		return await this.wrapInMiddlewares(async (req: QueryProcedureRequest) => {
			const customProcedure = this.customQueries[req.procedure];

			if (!customProcedure) {
				throw new Error(`Unknown query procedure: ${req.procedure}`);
			}

			const validationResult = customProcedure.inputValidator[
				'~standard'
			].validate(req.input);

			const result =
				validationResult instanceof Promise
					? await validationResult
					: validationResult;

			if (result.issues) {
				const errorMessage = result.issues
					.map(
						(issue: {
							message: string;
							path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
						}) => {
							const path = issue.path
								?.map((p) =>
									typeof p === 'object' && 'key' in p
										? String(p.key)
										: String(p),
								)
								.join('.');
							return path ? `${path}: ${issue.message}` : issue.message;
						},
					)
					.join(', ');
				throw new Error(`Validation failed: ${errorMessage}`);
			}

			req.input = result.value;

			return customProcedure.handler({
				req,
				db: serverDB,
			});
		})(req);
	};

	private wrapInMiddlewares<T extends Request>(
		next: NextFunction<any, T>,
	): NextFunction<any, T> {
		return (req: T) => {
			return Array.from(this.middlewares.values()).reduceRight(
				(next, middleware) => {
					return (req) =>
						middleware({ req, next: next as NextFunction<any, any> });
				},
				next,
			)(req);
		};
	}
}

export type TypedMiddleware<TContextIn, TContextOut> = {
	_brand: 'TypedMiddleware';
	_rawMiddleware: Middleware<any>;
	_contextIn?: TContextIn;
	_contextOut?: TContextOut;
};

export function createMiddleware<TContextIn, TContextOut = TContextIn>(
	fn: (opts: {
		ctx: TContextIn;
		req: Request<TContextIn>;
		next: (ctx: TContextOut) => any;
	}) => any,
): TypedMiddleware<TContextIn, TContextOut> {
	const rawMiddleware: Middleware<any> = ({ req, next: rawNext }) => {
		return fn({
			ctx: req.context as TContextIn,
			req: req as Request<TContextIn>,
			next: (ctx: TContextOut) => {
				(req as any).context = ctx;
				return rawNext(req);
			},
		});
	};
	return {
		_brand: 'TypedMiddleware' as const,
		_rawMiddleware: rawMiddleware,
	} as TypedMiddleware<TContextIn, TContextOut>;
}

export class RouteFactory<
	TSchema extends Schema<any> = Schema<any>,
	TContext = Record<string, any>,
> {
	private middlewares: Middleware<any>[];

	private constructor(middlewares: Middleware<any>[] = []) {
		this.middlewares = middlewares;
	}

	withProcedures<T extends Record<string, Procedure<any, any, any>>>(
		procedureFactory: (opts: {
			mutation: MutationCreator<TSchema, TContext>;
			query: QueryCreator<TSchema, TContext>;
		}) => T,
	) {
		const procedures = procedureFactory({
			mutation: mutationCreator as MutationCreator<TSchema, TContext>,
			query: queryCreator as QueryCreator<TSchema, TContext>,
		});

		const mutations: Record<string, Mutation<any, any>> = {};
		const queries: Record<string, Query<any, any>> = {};

		for (const [key, procedure] of Object.entries(procedures)) {
			if (procedure._type === 'mutation') {
				mutations[key] = procedure;
			} else {
				queries[key] = procedure;
			}
		}

		type ExtractMutations<R> = {
			[K in keyof R as R[K] extends Mutation<any, any> ? K : never]: Extract<
				R[K],
				Mutation<any, any>
			>;
		};
		type ExtractQueries<R> = {
			[K in keyof R as R[K] extends Query<any, any> ? K : never]: Extract<
				R[K],
				Query<any, any>
			>;
		};

		return new Route<
			Middleware<any>,
			ExtractMutations<T>,
			ExtractQueries<T>,
			TSchema,
			TContext
		>(mutations as ExtractMutations<T>, queries as ExtractQueries<T>).use(
			...this.middlewares,
		);
	}

	/**
	 * @deprecated Use `withProcedures` instead
	 */
	withMutations<T extends Record<string, Mutation<any, any>>>(
		mutationFactory: (opts: {
			mutation: MutationCreator<TSchema, TContext>;
		}) => T,
	) {
		return this.withProcedures(({ mutation }) => mutationFactory({ mutation }));
	}

	use<TNewContext>(
		mw: TypedMiddleware<TContext, TNewContext>,
	): RouteFactory<TSchema, TNewContext>;
	use(...middlewares: Middleware<any>[]): RouteFactory<TSchema, TContext>;
	use(...args: any[]) {
		const rawMiddlewares = args.map((m: any) =>
			m && m._brand === 'TypedMiddleware' ? m._rawMiddleware : m,
		);
		return new RouteFactory<any, any>([...this.middlewares, ...rawMiddlewares]);
	}

	static create<
		TSchema extends Schema<any> = Schema<any>,
		TContext = Record<string, any>,
	>() {
		return new RouteFactory<TSchema, TContext>();
	}
}

export const routeFactory = RouteFactory.create;
