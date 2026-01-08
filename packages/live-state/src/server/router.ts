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

export type RouteRecord = Record<string, AnyRoute>;

export class Router<TRoutes extends RouteRecord> {
  readonly routes: TRoutes;
  readonly hooksRegistry: Map<string, Hooks<any>> = new Map();

  private constructor(opts: { routes: TRoutes }) {
    this.routes = opts.routes;

    for (const route of Object.values(opts.routes)) {
      const typedRoute = route;

      if (typedRoute.hooks) {
        this.hooksRegistry.set(
          typedRoute.resourceSchema.name,
          typedRoute.hooks
        );
      }
    }
  }

  public static create<TRoutes extends RouteRecord>(opts: { routes: TRoutes }) {
    return new Router<TRoutes>(opts);
  }

  public getHooks(resourceName: string): Hooks<any> | undefined {
    return this.hooksRegistry.get(resourceName);
  }
}

export const router = <
  TSchema extends Schema<any>,
  TRoutes extends Record<keyof TSchema, Route<any, any, any>>,
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
> = {
  inputValidator: TInputValidator;
  handler: (opts: {
    req: MutationRequest<
      TInputValidator extends StandardSchemaV1<any, any>
        ? StandardSchemaV1.InferOutput<TInputValidator>
        : undefined
    >;
    db: Storage;
  }) => TOutput;
};

type MutationCreator = {
  // Overload for no validator (no input required)
  (): {
    handler: <TOutput>(
      handler: (opts: {
        req: MutationRequest<undefined>;
        db: Storage;
      }) => TOutput
    ) => Mutation<StandardSchemaV1<any, undefined>, TOutput>;
  };
  // Overload for with validator
  <TInputValidator extends StandardSchemaV1<any, any>>(
    validator: TInputValidator
  ): {
    handler: <
      THandler extends (opts: {
        req: MutationRequest<StandardSchemaV1.InferOutput<TInputValidator>>;
        db: Storage;
      }) => any,
    >(
      handler: THandler
    ) => Mutation<TInputValidator, ReturnType<THandler>>;
  };
};

const mutationCreator = (<TInputValidator extends StandardSchemaV1<any, any>>(
  validator?: TInputValidator
) => {
  return {
    handler: <THandler extends Mutation<TInputValidator, any>["handler"]>(
      handler: THandler
    ) =>
      ({
        inputValidator:
          validator ?? (z.undefined() as StandardSchemaV1<any, undefined>),
        handler,
      }) as Mutation<TInputValidator, ReturnType<THandler>>,
  };
}) as MutationCreator;

export type ReadAuthorizationHandler<TShape extends LiveObjectAny> = (opts: {
  ctx: BaseRequest["context"];
}) => WhereClause<TShape> | boolean;

export type MutationAuthorizationHandler<TShape extends LiveObjectAny> =
  (opts: {
    ctx: BaseRequest["context"];
    value: Simplify<InferLiveObjectWithRelationalIds<TShape>>;
  }) => WhereClause<TShape> | boolean;

export type Authorization<TShape extends LiveObjectAny> = {
  read?: ReadAuthorizationHandler<TShape>;
  insert?: MutationAuthorizationHandler<TShape>;
  update?: {
    preMutation?: MutationAuthorizationHandler<TShape>;
    postMutation?: MutationAuthorizationHandler<TShape>;
  };
};

// Lifecycle Hook Types
export type BeforeInsertHook<TShape extends LiveObjectAny> = (opts: {
  ctx?: Record<string, any>;
  value: MaterializedLiveType<TShape>;
  db: Storage;
}) =>
  | Promise<MaterializedLiveType<TShape> | void>
  | MaterializedLiveType<TShape>
  | void;

export type AfterInsertHook<TShape extends LiveObjectAny> = (opts: {
  ctx?: Record<string, any>;
  value: MaterializedLiveType<TShape>;
  db: Storage;
}) => Promise<void> | void;

export type BeforeUpdateHook<TShape extends LiveObjectAny> = (opts: {
  ctx?: Record<string, any>;
  value: MaterializedLiveType<TShape>;
  previousValue?: MaterializedLiveType<TShape>;
  db: Storage;
}) =>
  | Promise<MaterializedLiveType<TShape> | void>
  | MaterializedLiveType<TShape>
  | void;

export type AfterUpdateHook<TShape extends LiveObjectAny> = (opts: {
  ctx?: Record<string, any>;
  value: MaterializedLiveType<TShape>;
  previousValue?: MaterializedLiveType<TShape>;
  db: Storage;
}) => Promise<void> | void;

export type Hooks<TShape extends LiveObjectAny> = {
  beforeInsert?: BeforeInsertHook<TShape>;
  afterInsert?: AfterInsertHook<TShape>;
  beforeUpdate?: BeforeUpdateHook<TShape>;
  afterUpdate?: AfterUpdateHook<TShape>;
};

export class Route<
  TResourceSchema extends LiveObjectAny,
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<string, Mutation<any, any>>,
> {
  readonly resourceSchema: TResourceSchema;
  readonly middlewares: Set<TMiddleware>;
  readonly customMutations: TCustomMutations;
  readonly authorization?: Authorization<TResourceSchema>;
  readonly hooks?: Hooks<TResourceSchema>;

  public constructor(
    resourceSchema: TResourceSchema,
    customMutations?: TCustomMutations,
    authorization?: Authorization<TResourceSchema>,
    hooks?: Hooks<TResourceSchema>
  ) {
    this.resourceSchema = resourceSchema;
    this.middlewares = new Set();
    this.customMutations = customMutations ?? ({} as TCustomMutations);
    this.authorization = authorization;
    this.hooks = hooks;
  }

  public use(...middlewares: TMiddleware[]) {
    for (const middleware of middlewares) {
      this.middlewares.add(middleware);
    }
    return this;
  }

  public withMutations<T extends Record<string, Mutation<any, any>>>(
    mutationFactory: (opts: { mutation: typeof mutationCreator }) => T
  ) {
    return new Route<TResourceSchema, TMiddleware, T>(
      this.resourceSchema,
      mutationFactory({ mutation: mutationCreator }),
      this.authorization,
      this.hooks
    );
  }

  public withHooks(hooks: Hooks<TResourceSchema>) {
    return new Route<TResourceSchema, TMiddleware, TCustomMutations>(
      this.resourceSchema,
      this.customMutations,
      this.authorization,
      hooks
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
    return await this.wrapInMiddlewares(async (req: MutationRequest) => {
      if (!req.procedure)
        throw new Error("Procedure is required for mutations");
      const customProcedure = this.customMutations[req.procedure];

      if (customProcedure) {
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
                      : String(p)
                  )
                  .join(".");
                return path ? `${path}: ${issue.message}` : issue.message;
              }
            )
            .join(", ");
          throw new Error(`Validation failed: ${errorMessage}`);
        }

        req.input = result.value;

        return customProcedure.handler({
          req,
          db,
        });
      } else if (req.procedure === "INSERT" || req.procedure === "UPDATE") {
        return this.handleSet({
          req: req as MutationRequest<LiveObjectMutationInput<TResourceSchema>>,
          db,
          operation: req.procedure,
          schema,
        });
      } else {
        throw new Error(`Unknown procedure: ${req.procedure}`);
      }
    })(req);
  };

  public getAuthorizationClause(
    req: QueryRequest
  ): WhereClause<TResourceSchema> | undefined | boolean {
    return this.authorization?.read?.({
      ctx: req.context,
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
      req.resourceId
    );

    if (operation === "INSERT" && target) {
      throw new Error("Resource already exists");
    } else if (operation === "UPDATE" && !target) {
      throw new Error("Resource not found");
    }

    return db.transaction(async ({ trx }) => {
      const [newRecord, acceptedValues] = this.resourceSchema.mergeMutation(
        "set",
        req.input as Record<string, MaterializedLiveType<LiveTypeAny>>,
        target
      );

      if (!acceptedValues) {
        throw new Error("Mutation rejected");
      }

      if (operation === "INSERT") {
        const result = await trx.rawInsert<TResourceSchema>(
          req.resource,
          req.resourceId!,
          newRecord,
          req.context?.messageId,
          req.context
        );
        const inferredResultValue = inferValue(result) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;
        (inferredResultValue as any)["id"] =
          (inferredResultValue as any)["id"] ?? req.resourceId!;

        if (this.authorization?.insert) {
          const authorizationClause = this.authorization.insert({
            ctx: req.context,
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
              schema
            );

            const authorizationTarget =
              Object.keys(includeClause).length > 0
                ? await trx.rawFindById<TResourceSchema>(
                    req.resource,
                    req.resourceId!,
                    includeClause
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
          ctx: req.context,
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
            schema
          );

          const authorizationTarget =
            Object.keys(includeClause).length > 0
              ? await trx.rawFindById<TResourceSchema>(
                  req.resource,
                  req.resourceId!,
                  includeClause
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

      const result = await trx.rawUpdate<TResourceSchema>(
        req.resource,
        req.resourceId!,
        newRecord,
        req.context?.messageId,
        req.context
      );

      if (this.authorization?.update?.postMutation) {
        const inferredResultValue = inferValue(result) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;
        (inferredResultValue as any)["id"] =
          (inferredResultValue as any)["id"] ?? req.resourceId!;

        const authorizationClause = this.authorization.update.postMutation({
          ctx: req.context,
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
            schema
          );

          const authorizationTarget =
            Object.keys(includeClause).length > 0
              ? await trx.rawFindById<TResourceSchema>(
                  req.resource,
                  req.resourceId!,
                  includeClause
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
    next: NextFunction<any, T>
  ): NextFunction<any, T> {
    return (req: T) => {
      return Array.from(this.middlewares.values()).reduceRight(
        (next, middleware) => {
          return (req) =>
            middleware({ req, next: next as NextFunction<any, any> });
        },
        next
      )(req);
    };
  }
}

export class RouteFactory {
  private middlewares: Middleware<any>[];

  private constructor(middlewares: Middleware<any>[] = []) {
    this.middlewares = middlewares;
  }

  collectionRoute<T extends LiveObjectAny>(
    shape: T,
    authorization?: Authorization<T>
  ) {
    return new Route<T, Middleware<any>, Record<string, never>>(
      shape,
      undefined,
      authorization,
      undefined
    ).use(...this.middlewares);
  }

  use(...middlewares: Middleware<any>[]) {
    return new RouteFactory([...this.middlewares, ...middlewares]);
  }

  static create() {
    return new RouteFactory();
  }
}

export const routeFactory = RouteFactory.create;

export type AnyRoute = Route<
  LiveObjectAny,
  Middleware<any>,
  Record<string, any>
>;
