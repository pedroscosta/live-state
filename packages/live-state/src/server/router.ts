/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
/** biome-ignore-all lint/style/noNonNullAssertion: false positive */

import { z } from "zod";
import type * as z3 from "zod/v3";
import type * as z4 from "zod/v4/core";
import { mergeWhereClauses } from "../core/utils";
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
import { applyWhere, type Simplify } from "../utils";
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

  private constructor(opts: { routes: TRoutes }) {
    this.routes = opts.routes;
  }

  public static create<TRoutes extends RouteRecord>(opts: { routes: TRoutes }) {
    return new Router<TRoutes>(opts);
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
  data: Record<string, MaterializedLiveType<TShape>>;
};

export type MutationResult<TShape extends LiveObjectAny> = {
  data: MaterializedLiveType<TShape>;
  acceptedValues: Record<string, any> | null;
};

export type Mutation<
  TInputValidator extends z3.ZodTypeAny | z4.$ZodType, // TODO use StandardSchema instead
  TOutput,
> = {
  inputValidator: TInputValidator;
  handler: (opts: {
    req: MutationRequest<z.infer<TInputValidator>>;
    db: Storage;
  }) => TOutput;
};

const mutationCreator = <TInputValidator extends z3.ZodTypeAny | z4.$ZodType>(
  validator?: TInputValidator
) => {
  return {
    handler: <THandler extends Mutation<TInputValidator, any>["handler"]>(
      handler: THandler
    ) =>
      ({
        inputValidator: validator ?? z.undefined(),
        handler,
      }) as Mutation<TInputValidator, ReturnType<THandler>>,
  };
};

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

export class Route<
  TResourceSchema extends LiveObjectAny,
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<string, Mutation<any, any>>,
> {
  readonly resourceSchema: TResourceSchema;
  readonly middlewares: Set<TMiddleware>;
  readonly customMutations: TCustomMutations;
  readonly authorization?: Authorization<TResourceSchema>;

  public constructor(
    resourceSchema: TResourceSchema,
    customMutations?: TCustomMutations,
    authorization?: Authorization<TResourceSchema>
  ) {
    this.resourceSchema = resourceSchema;
    this.middlewares = new Set();
    this.customMutations = customMutations ?? ({} as TCustomMutations);
    this.authorization = authorization;
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
      mutationFactory({ mutation: mutationCreator })
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
      const authorizationClause = this.authorization?.read?.({
        ctx: req.context,
      });

      if (typeof authorizationClause === "boolean" && !authorizationClause) {
        throw new Error("Not authorized");
      }

      return {
        data: await batcher.rawFind<TResourceSchema>(
          req.resource,
          mergeWhereClauses(
            req.where,
            typeof authorizationClause === "object"
              ? authorizationClause
              : undefined
          ),
          req.relationalWhere,
          req.include
        ),
      };
    })(req);
  };

  /** @internal */
  public handleMutation = async ({
    req,
    db,
  }: {
    req: MutationRequest;
    db: Storage;
  }): Promise<any> => {
    return await this.wrapInMiddlewares(async (req: MutationRequest) => {
      if (!req.procedure)
        throw new Error("Procedure is required for mutations");
      const customProcedure = this.customMutations[req.procedure];

      if (customProcedure) {
        const validInput = customProcedure.inputValidator.parse(req.input);

        req.input = validInput;

        return customProcedure.handler({
          req,
          db,
        });
      } else if (req.procedure === "INSERT" || req.procedure === "UPDATE") {
        return this.handleSet({
          req: req as MutationRequest<LiveObjectMutationInput<TResourceSchema>>,
          db,
          operation: req.procedure,
        });
      } else {
        throw new Error(`Unknown procedure: ${req.procedure}`);
      }
    })(req);
  };

  private handleSet = async ({
    req,
    db,
    operation,
  }: {
    req: MutationRequest;
    db: Storage;
    operation: "INSERT" | "UPDATE";
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
          newRecord
        );

        if (this.authorization?.insert) {
          const inferredValue = inferValue(result) as Simplify<
            InferLiveObjectWithRelationalIds<TResourceSchema>
          >;

          (inferredValue as any)["id"] =
            (inferredValue as any)["id"] ?? req.resourceId!;

          const authorizationClause = this.authorization.insert({
            ctx: req.context,
            value: inferredValue as Simplify<
              InferLiveObjectWithRelationalIds<TResourceSchema>
            >,
          });

          const authorized =
            typeof authorizationClause === "boolean"
              ? authorizationClause
              : applyWhere(inferredValue, authorizationClause);

          if (!authorized) {
            throw new Error("Not authorized");
          }
        }

        return {
          data: result,
          acceptedValues,
        };
      }

      if (this.authorization?.update?.preMutation) {
        const inferredValue = inferValue(target) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;

        (inferredValue as any)["id"] =
          (inferredValue as any)["id"] ?? req.resourceId!;

        const authorizationClause = this.authorization.update.preMutation({
          ctx: req.context,
          value: inferredValue,
        });

        const authorized =
          typeof authorizationClause === "boolean"
            ? authorizationClause
            : applyWhere(inferredValue, authorizationClause);

        if (!authorized) {
          throw new Error("Not authorized");
        }
      }

      const result = await trx.rawUpdate<TResourceSchema>(
        req.resource,
        req.resourceId!,
        newRecord
      );

      if (this.authorization?.update?.postMutation) {
        const inferredValue = inferValue(result) as Simplify<
          InferLiveObjectWithRelationalIds<TResourceSchema>
        >;

        (inferredValue as any)["id"] =
          (inferredValue as any)["id"] ?? req.resourceId!;

        const authorizationClause = this.authorization.update.postMutation({
          ctx: req.context,
          value: inferredValue,
        });

        const authorized =
          typeof authorizationClause === "boolean"
            ? authorizationClause
            : applyWhere(inferredValue, authorizationClause);

        if (!authorized) {
          throw new Error("Not authorized");
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
      authorization
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
