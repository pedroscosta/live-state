/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
/** biome-ignore-all lint/style/noNonNullAssertion: false positive */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import type { RawQueryRequest } from "../core/schemas/core-protocol";
import {
  type InferLiveObjectWithRelationalIds,
  inferValue,
  type LiveObjectAny,
  type LiveObjectMutationInput,
  type LiveTypeAny,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../schema";
import {
  applyWhere,
  extractIncludeFromWhere,
  hash,
  type Simplify,
} from "../utils";
import type {
  BaseRequest,
  Middleware,
  MutationRequest,
  NextFunction,
  QueryRequest,
  Request,
  Storage,
} from ".";
import type { Batcher } from "./storage/batcher";
import { createServerDB, type ServerDB } from "./storage/server-query-builder";

export type AnyProcedureRoute = ProcedureRoute<
  Middleware<any>,
  Record<string, any>,
  Record<string, any>,
  any,
  any
>;
export type AnyRouteOrProcedure = AnyRoute | AnyProcedureRoute;
export type RouteRecord = Record<string, AnyRouteOrProcedure>;

export class Router<TRoutes extends RouteRecord> {
  readonly routes: TRoutes;
  readonly hooksRegistry: Map<string, Hooks<any, any, any>> = new Map();

  private constructor(opts: { routes: TRoutes }) {
    this.routes = opts.routes;

    for (const route of Object.values(opts.routes)) {
      if (route.resourceSchema === undefined) continue;
      const typedRoute = route as AnyRoute;

      if (typedRoute.hooks) {
        this.hooksRegistry.set(
          typedRoute.resourceSchema.name,
          typedRoute.hooks,
        );
      }
    }
  }

  public static create<TRoutes extends RouteRecord>(opts: { routes: TRoutes }) {
    return new Router<TRoutes>(opts);
  }

  public getHooks(resourceName: string): Hooks<any, any, any> | undefined {
    return this.hooksRegistry.get(resourceName);
  }
}

export const router = <
  TSchema extends Schema<any>,
  TRoutes extends Record<keyof TSchema, Route<any, any, any, any, any, any>> &
    Record<string, Route<any, any, any, any, any, any> | ProcedureRoute<any, any, any, any, any>>,
>(opts: {
  schema: TSchema;
  routes: TRoutes;
}) => Router.create<TRoutes>({ ...opts });

export type AnyRouter = Router<any>;

export type QueryResult<TShape extends LiveObjectAny> = {
  data: MaterializedLiveType<TShape>[];
  unsubscribe?: () => void;
};

export type MutationResult<TShape extends LiveObjectAny> = {
  data: MaterializedLiveType<TShape>;
  acceptedValues: Record<string, any> | null;
};

export type Mutation<
  TInputValidator extends StandardSchemaV1<any, any> | never,
  TOutput,
  TContext = Record<string, any>,
> = {
  _type: "mutation";
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

export interface QueryProcedureRequest<TInput = any, TContext = Record<string, any>> extends BaseRequest<TContext> {
  type: "CUSTOM_QUERY";
  input: TInput;
  resource: string;
  procedure: string;
}

export type Query<
  TInputValidator extends StandardSchemaV1<any, any> | never,
  TOutput,
  TContext = Record<string, any>,
> = {
  _type: "query";
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
> = Mutation<TInputValidator, TOutput, TContext> | Query<TInputValidator, TOutput, TContext>;

type QueryCreator<TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = {
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
    handler: <THandler extends Query<TInputValidator, any>["handler"]>(
      handler: THandler,
    ) =>
      ({
        _type: "query",
        inputValidator:
          validator ?? (z.undefined() as StandardSchemaV1<any, undefined>),
        handler,
      }) as Query<TInputValidator, ReturnType<THandler>>,
  };
}) as QueryCreator;

type MutationCreator<TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = {
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
        req: MutationRequest<StandardSchemaV1.InferOutput<TInputValidator>, TContext>;
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
    handler: <THandler extends Mutation<TInputValidator, any>["handler"]>(
      handler: THandler,
    ) =>
      ({
        _type: "mutation",
        inputValidator:
          validator ?? (z.undefined() as StandardSchemaV1<any, undefined>),
        handler,
      }) as Mutation<TInputValidator, ReturnType<THandler>>,
  };
}) as MutationCreator;

export type ReadAuthorizationHandler<TShape extends LiveObjectAny, TContext = Record<string, any>> = (opts: {
  ctx: TContext;
}) => WhereClause<TShape> | boolean;

export type MutationAuthorizationHandler<TShape extends LiveObjectAny, TContext = Record<string, any>> =
  (opts: {
    ctx: TContext;
    value: Simplify<InferLiveObjectWithRelationalIds<TShape>>;
  }) => WhereClause<TShape> | boolean;

export type Authorization<TShape extends LiveObjectAny, TContext = Record<string, any>> = {
  read?: ReadAuthorizationHandler<TShape, TContext>;
  insert?: MutationAuthorizationHandler<TShape, TContext>;
  update?: {
    preMutation?: MutationAuthorizationHandler<TShape, TContext>;
    postMutation?: MutationAuthorizationHandler<TShape, TContext>;
  };
};

// Lifecycle Hook Types
export type BeforeInsertHook<TShape extends LiveObjectAny, TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = (opts: {
  ctx?: TContext;
  value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
  rawValue: MaterializedLiveType<TShape>;
  db: ServerDB<TSchema>;
}) =>
  | Promise<MaterializedLiveType<TShape> | void>
  | MaterializedLiveType<TShape>
  | void;

export type AfterInsertHook<TShape extends LiveObjectAny, TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = (opts: {
  ctx?: TContext;
  value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
  rawValue: MaterializedLiveType<TShape>;
  db: ServerDB<TSchema>;
}) => Promise<void> | void;

export type BeforeUpdateHook<TShape extends LiveObjectAny, TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = (opts: {
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

export type AfterUpdateHook<TShape extends LiveObjectAny, TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = (opts: {
  ctx?: TContext;
  value: Simplify<InferLiveObjectWithRelationalIds<TShape>> & { id: string };
  rawValue: MaterializedLiveType<TShape>;
  previousValue?: Simplify<InferLiveObjectWithRelationalIds<TShape>> & {
    id: string;
  };
  previousRawValue?: MaterializedLiveType<TShape>;
  db: ServerDB<TSchema>;
}) => Promise<void> | void;

export type Hooks<TShape extends LiveObjectAny, TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> = {
  beforeInsert?: BeforeInsertHook<TShape, TSchema, TContext>;
  afterInsert?: AfterInsertHook<TShape, TSchema, TContext>;
  beforeUpdate?: BeforeUpdateHook<TShape, TSchema, TContext>;
  afterUpdate?: AfterUpdateHook<TShape, TSchema, TContext>;
};

export class Route<
  TResourceSchema extends LiveObjectAny,
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<string, Mutation<any, any>>,
  TCustomQueries extends Record<string, Query<any, any>>,
  TSchema extends Schema<any> = Schema<any>,
  TContext = Record<string, any>,
> {
  readonly resourceSchema: TResourceSchema;
  readonly middlewares: Set<TMiddleware>;
  readonly customMutations: TCustomMutations;
  readonly customQueries: TCustomQueries;
  readonly authorization?: Authorization<TResourceSchema, TContext>;
  readonly hooks?: Hooks<TResourceSchema, TSchema, TContext>;

  public constructor(
    resourceSchema: TResourceSchema,
    customMutations?: TCustomMutations,
    customQueries?: TCustomQueries,
    authorization?: Authorization<TResourceSchema, TContext>,
    hooks?: Hooks<TResourceSchema, TSchema, TContext>,
  ) {
    this.resourceSchema = resourceSchema;
    this.middlewares = new Set();
    this.customMutations = customMutations ?? ({} as TCustomMutations);
    this.customQueries = customQueries ?? ({} as TCustomQueries);
    this.authorization = authorization;
    this.hooks = hooks;
  }

  public use(...middlewares: TMiddleware[]) {
    for (const middleware of middlewares) {
      this.middlewares.add(middleware);
    }
    return this;
  }

  public withProcedures<T extends Record<string, Procedure<any, any, any>>>(
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
      if (procedure._type === "mutation") {
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
      TResourceSchema,
      TMiddleware,
      ExtractMutations<T>,
      ExtractQueries<T>,
      TSchema,
      TContext
    >(
      this.resourceSchema,
      mutations as ExtractMutations<T>,
      queries as ExtractQueries<T>,
      this.authorization,
      this.hooks,
    );
  }

  /**
   * @deprecated Use `withProcedures` instead
   */
  public withMutations<T extends Record<string, Mutation<any, any>>>(
    mutationFactory: (opts: { mutation: MutationCreator<TSchema, TContext> }) => T,
  ) {
    return this.withProcedures(({ mutation }) => mutationFactory({ mutation }));
  }

  /**
   * @deprecated Declare hooks with `defineHooks` and pass them to `server({ hooks })` instead.
   */
  public withHooks(hooks: Hooks<TResourceSchema, TSchema, TContext>) {
    return new Route<
      TResourceSchema,
      TMiddleware,
      TCustomMutations,
      TCustomQueries,
      TSchema,
      TContext
    >(
      this.resourceSchema,
      this.customMutations,
      this.customQueries,
      this.authorization,
      hooks,
    );
  }

  /** @internal */
  public handleQuery = async ({
    req,
    batcher,
  }: {
    req: QueryRequest;
    batcher: Batcher;
  }): Promise<QueryResult<TResourceSchema>> => {
    return await this.wrapInMiddlewares(async (req: QueryRequest) => {
      // const authorizationClause = this.authorization?.read?.({
      //   ctx: req.context,
      // });

      // if (typeof authorizationClause === "boolean" && !authorizationClause) {
      //   throw new Error("Not authorized");
      // }

      // const mergedWhere = mergeWhereClauses(
      //   req.where,
      //   typeof authorizationClause === "object"
      //     ? authorizationClause
      //     : undefined
      // );

      const rawQuery: RawQueryRequest = {
        resource: req.resource,
        where: req.where,
        include: req.include,
        lastSyncedAt: req.lastSyncedAt,
        limit: req.limit,
        sort: req.sort,
      };

      const queryHash = hash(rawQuery);

      let unsubscribeFunction: (() => void) | undefined;

      const data = await batcher.rawFind<TResourceSchema>({
        resource: req.resource,
        commonWhere: req.where,
        uniqueWhere: req.relationalWhere,
        include: req.include,
        limit: req.limit,
        sort: req.sort,
      });

      return {
        data,
        unsubscribe: unsubscribeFunction,
        queryHash,
      };
    })(req);
  };

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
        throw new Error("Procedure is required for mutations");
      // TODO: Remove this INSERT/UPDATE alias resolution when default mutations are removed.
      const fallbackCustomProcedureName =
        req.procedure === "INSERT"
          ? "insert"
          : req.procedure === "UPDATE"
            ? "update"
            : undefined;
      const resolvedCustomProcedureName =
        this.customMutations[req.procedure]
          ? req.procedure
          : fallbackCustomProcedureName &&
              this.customMutations[fallbackCustomProcedureName]
            ? fallbackCustomProcedureName
            : req.procedure;
      const customProcedure =
        this.customMutations[resolvedCustomProcedureName];

      if (customProcedure) {
        req.procedure = resolvedCustomProcedureName;
        const validationResult = customProcedure.inputValidator[
          "~standard"
        ].validate(req.input);

        // Handle both sync and async validation
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
                    typeof p === "object" && "key" in p
                      ? String(p.key)
                      : String(p),
                  )
                  .join(".");
                return path ? `${path}: ${issue.message}` : issue.message;
              },
            )
            .join(", ");
          throw new Error(`Validation failed: ${errorMessage}`);
        }

        req.input = result.value;

        return customProcedure.handler({
          req,
          db: serverDB,
        });
      } else if (req.procedure === "INSERT" || req.procedure === "UPDATE") {
        return this.handleSet({
          req: req as MutationRequest<
            LiveObjectMutationInput<TResourceSchema>
          >,
          db: mutationDb,
          operation: req.procedure,
          schema,
        });
      } else {
        throw new Error(`Unknown procedure: ${req.procedure}`);
      }
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
        "~standard"
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
                  typeof p === "object" && "key" in p
                    ? String(p.key)
                    : String(p),
                )
                .join(".");
              return path ? `${path}: ${issue.message}` : issue.message;
            },
          )
          .join(", ");
        throw new Error(`Validation failed: ${errorMessage}`);
      }

      req.input = result.value;

      return customProcedure.handler({
        req,
        db: serverDB,
      });
    })(req);
  };

  public getAuthorizationClause(
    req: QueryRequest,
  ): WhereClause<TResourceSchema> | undefined | boolean {
    return this.authorization?.read?.({
      ctx: req.context as TContext,
    });
  }

  private handleSet = async ({
    req,
    db,
    operation,
    schema,
  }: {
    req: MutationRequest;
    db: Storage;
    operation: "INSERT" | "UPDATE";
    schema: Schema<any>;
  }): Promise<MutationResult<TResourceSchema>> => {
    if (!req.input) throw new Error("Payload is required");
    if (!req.resourceId) throw new Error("ResourceId is required");

    const target = await db.rawFindById<TResourceSchema>(
      req.resource,
      req.resourceId,
    );

    if (operation === "INSERT" && target) {
      throw new Error("Resource already exists");
    } else if (operation === "UPDATE" && !target) {
      throw new Error("Resource not found");
    }

    const inputValue = {
      value: req.input as Record<string, MaterializedLiveType<LiveTypeAny>>,
    } as MaterializedLiveType<TResourceSchema>;

    return db.transaction(async ({ trx }) => {
      if (operation === "INSERT") {
        const { data: result, acceptedValues } =
          await trx.rawInsert<TResourceSchema>(
            req.resource,
            req.resourceId!,
            inputValue,
            req.context?.messageId,
            req.context,
          );

        if (!acceptedValues) {
          throw new Error("Mutation rejected");
        }

        const inferredResultValue = inferValue(result) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;
        (inferredResultValue as any)["id"] =
          (inferredResultValue as any)["id"] ?? req.resourceId!;

        if (this.authorization?.insert) {
          const authorizationClause = this.authorization.insert({
            ctx: req.context as TContext,
            value: inferredResultValue as Simplify<
              InferLiveObjectWithRelationalIds<TResourceSchema>
            >,
          });

          if (typeof authorizationClause === "boolean") {
            if (!authorizationClause) {
              throw new Error("Not authorized");
            }
          } else {
            const includeClause = extractIncludeFromWhere(
              authorizationClause,
              req.resource,
              schema,
            );

            const authorizationTarget =
              Object.keys(includeClause).length > 0
                ? await trx.rawFindById<TResourceSchema>(
                    req.resource,
                    req.resourceId!,
                    includeClause,
                  )
                : result;

            const inferredValue = inferValue(authorizationTarget) as Simplify<
              InferLiveObjectWithRelationalIds<TResourceSchema>
            >;

            (inferredValue as any)["id"] =
              (inferredValue as any)["id"] ?? req.resourceId!;

            const authorized = applyWhere(inferredValue, authorizationClause);

            if (!authorized) {
              throw new Error("Not authorized");
            }
          }
        }

        return {
          data: result,
          acceptedValues,
        };
      }

      if (this.authorization?.update?.preMutation) {
        const inferredTargetValue = inferValue(target) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;
        (inferredTargetValue as any)["id"] =
          (inferredTargetValue as any)["id"] ?? req.resourceId!;

        const authorizationClause = this.authorization.update.preMutation({
          ctx: req.context as TContext,
          value: inferredTargetValue as Simplify<
            InferLiveObjectWithRelationalIds<TResourceSchema>
          >,
        });

        if (typeof authorizationClause === "boolean") {
          if (!authorizationClause) {
            throw new Error("Not authorized");
          }
        } else {
          const includeClause = extractIncludeFromWhere(
            authorizationClause,
            req.resource,
            schema,
          );

          const authorizationTarget =
            Object.keys(includeClause).length > 0
              ? await trx.rawFindById<TResourceSchema>(
                  req.resource,
                  req.resourceId!,
                  includeClause,
                )
              : target;

          const inferredValue = inferValue(authorizationTarget) as Simplify<
            InferLiveObjectWithRelationalIds<TResourceSchema>
          >;

          (inferredValue as any)["id"] =
            (inferredValue as any)["id"] ?? req.resourceId!;

          const authorized = applyWhere(inferredValue, authorizationClause);

          if (!authorized) {
            throw new Error("Not authorized");
          }
        }
      }

      const { data: result, acceptedValues } =
        await trx.rawUpdate<TResourceSchema>(
          req.resource,
          req.resourceId!,
          inputValue,
          req.context?.messageId,
          req.context,
        );

      if (!acceptedValues) {
        throw new Error("Mutation rejected");
      }

      if (this.authorization?.update?.postMutation) {
        const inferredResultValue = inferValue(result) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;
        (inferredResultValue as any)["id"] =
          (inferredResultValue as any)["id"] ?? req.resourceId!;

        const authorizationClause = this.authorization.update.postMutation({
          ctx: req.context as TContext,
          value: inferredResultValue as Simplify<
            InferLiveObjectWithRelationalIds<TResourceSchema>
          >,
        });

        if (typeof authorizationClause === "boolean") {
          if (!authorizationClause) {
            throw new Error("Not authorized");
          }
        } else {
          const includeClause = extractIncludeFromWhere(
            authorizationClause,
            req.resource,
            schema,
          );

          const authorizationTarget =
            Object.keys(includeClause).length > 0
              ? await trx.rawFindById<TResourceSchema>(
                  req.resource,
                  req.resourceId!,
                  includeClause,
                )
              : result;

          const inferredValue = inferValue(authorizationTarget) as Simplify<
            InferLiveObjectWithRelationalIds<TResourceSchema>
          >;

          (inferredValue as any)["id"] =
            (inferredValue as any)["id"] ?? req.resourceId!;

          const authorized = applyWhere(inferredValue, authorizationClause);

          if (!authorized) {
            throw new Error("Not authorized");
          }
        }
      }

      return {
        data: result,
        acceptedValues,
      };
    });
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

export class ProcedureRoute<
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<string, Mutation<any, any>>,
  TCustomQueries extends Record<string, Query<any, any>>,
  TSchema extends Schema<any> = Schema<any>,
  TContext = Record<string, any>,
> {
  readonly resourceSchema: undefined = undefined;
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
        throw new Error("Procedure is required for mutations");

      const customProcedure = this.customMutations[req.procedure];

      if (customProcedure) {
        const validationResult = customProcedure.inputValidator[
          "~standard"
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
                    typeof p === "object" && "key" in p
                      ? String(p.key)
                      : String(p),
                  )
                  .join(".");
                return path ? `${path}: ${issue.message}` : issue.message;
              },
            )
            .join(", ");
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
        "~standard"
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
                  typeof p === "object" && "key" in p
                    ? String(p.key)
                    : String(p),
                )
                .join(".");
              return path ? `${path}: ${issue.message}` : issue.message;
            },
          )
          .join(", ");
        throw new Error(`Validation failed: ${errorMessage}`);
      }

      req.input = result.value;

      return customProcedure.handler({
        req,
        db: serverDB,
      });
    })(req);
  };

  public getAuthorizationClause(): undefined {
    return undefined;
  }

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
  _brand: "TypedMiddleware";
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
    _brand: "TypedMiddleware" as const,
    _rawMiddleware: rawMiddleware,
  } as TypedMiddleware<TContextIn, TContextOut>;
}

export class RouteFactory<TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>> {
  private middlewares: Middleware<any>[];

  private constructor(middlewares: Middleware<any>[] = []) {
    this.middlewares = middlewares;
  }

  collectionRoute<T extends LiveObjectAny>(
    shape: T,
    authorization?: Authorization<T, TContext>,
  ) {
    return new Route<
      T,
      Middleware<any>,
      Record<string, never>,
      Record<string, never>,
      TSchema,
      TContext
    >(shape, undefined, undefined, authorization, undefined).use(
      ...this.middlewares,
    );
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
      if (procedure._type === "mutation") {
        mutations[key] = procedure;
      } else {
        queries[key] = procedure;
      }
    }

    type ExtractMutations<R> = {
      [K in keyof R as R[K] extends Mutation<any, any> ? K : never]: R[K];
    };
    type ExtractQueries<R> = {
      [K in keyof R as R[K] extends Query<any, any> ? K : never]: R[K];
    };

    return new ProcedureRoute<
      Middleware<any>,
      ExtractMutations<T> & Record<string, Mutation<any, any>>,
      ExtractQueries<T> & Record<string, Query<any, any>>,
      TSchema,
      TContext
    >(
      mutations as ExtractMutations<T> & Record<string, Mutation<any, any>>,
      queries as ExtractQueries<T> & Record<string, Query<any, any>>,
    ).use(...this.middlewares);
  }

  use<TNewContext>(mw: TypedMiddleware<TContext, TNewContext>): RouteFactory<TSchema, TNewContext>;
  use(...middlewares: Middleware<any>[]): RouteFactory<TSchema, TContext>;
  use(...args: any[]) {
    const rawMiddlewares = args.map((m: any) =>
      m && m._brand === "TypedMiddleware" ? m._rawMiddleware : m,
    );
    return new RouteFactory<any, any>([...this.middlewares, ...rawMiddlewares]);
  }

  static create<TSchema extends Schema<any> = Schema<any>, TContext = Record<string, any>>() {
    return new RouteFactory<TSchema, TContext>();
  }
}

export const routeFactory = RouteFactory.create;

export type AnyRoute = Route<
  LiveObjectAny,
  Middleware<any>,
  Record<string, any>,
  Record<string, any>,
  any,
  any
>;
