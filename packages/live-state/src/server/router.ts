/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
/** biome-ignore-all lint/style/noNonNullAssertion: false positive */

import { z } from "zod";
import type * as z3 from "zod/v3";
import type * as z4 from "zod/v4/core";

import {
  inferValue,
  type LiveObjectAny,
  type LiveObjectMutationInput,
  type LiveTypeAny,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../schema";
import { applyWhere } from "../utils";
import type { Middleware, NextFunction, ParsedRequest, Storage } from ".";

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
  TRoutes extends Record<keyof TSchema, AnyRoute>,
>(opts: {
  schema: TSchema;
  routes: TRoutes;
}) => Router.create<TRoutes>({ ...opts });

export type AnyRouter = Router<RouteRecord>;

export type QueryResult<TShape extends LiveObjectAny> = {
  data: Record<string, MaterializedLiveType<TShape>>;
};

export type MutationResult<TShape extends LiveObjectAny> = {
  data: MaterializedLiveType<TShape>;
  acceptedValues: Record<string, any> | null;
};

export type RequestHandler<
  TInput,
  TResult,
  TSchema extends Schema<any> = Schema<any>,
> = (opts: {
  req: ParsedRequest<TInput>;
  db: Storage;
  schema: TSchema;
}) => Promise<TResult>;

export type Mutation<
  TInputValidator extends z3.ZodTypeAny | z4.$ZodType, // TODO use StandardSchema instead
  THandler extends RequestHandler<z.infer<TInputValidator>, any, any>,
> = {
  inputValidator: TInputValidator;
  handler: THandler;
};

const mutationCreator = <TInputValidator extends z3.ZodTypeAny | z4.$ZodType>(
  validator?: TInputValidator
) => {
  return {
    handler: <
      THandler extends RequestHandler<z.infer<TInputValidator>, any, any>,
    >(
      handler: THandler
    ) =>
      ({
        inputValidator: validator ?? z.undefined(),
        handler,
      }) as Mutation<TInputValidator, THandler>,
  };
};

export type AuthorizationHandler<TShape extends LiveObjectAny> = (
  req: ParsedRequest["context"]
) => WhereClause<TShape>;

export type Authorization<TShape extends LiveObjectAny> = {
  read?: AuthorizationHandler<TShape>;
  insert?: AuthorizationHandler<TShape>;
  update?: {
    preMutation?: AuthorizationHandler<TShape>;
    postMutation?: AuthorizationHandler<TShape>;
  };
};

export class Route<
  TResourceSchema extends LiveObjectAny,
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<
    string,
    Mutation<any, RequestHandler<any, any>>
  >,
> {
  readonly _resourceSchema!: TResourceSchema;
  readonly resourceName: TResourceSchema["name"];
  readonly middlewares: Set<TMiddleware>;
  readonly customMutations: TCustomMutations;
  readonly authorization?: Authorization<TResourceSchema>;

  public constructor(
    resourceName: TResourceSchema["name"],
    customMutations?: TCustomMutations,
    authorization?: Authorization<TResourceSchema>
  ) {
    this.resourceName = resourceName;
    this.middlewares = new Set();
    this.customMutations = customMutations ?? ({} as TCustomMutations);
    this.authorization = authorization;
  }

  public async handleRequest(opts: {
    req: ParsedRequest;
    db: Storage;
    schema: Schema<any>;
  }): Promise<any> {
    const next = (req: ParsedRequest) =>
      (() => {
        if (req.type === "QUERY") {
          return this.handleFind({
            req: req as ParsedRequest<never>,
            db: opts.db,
            schema: opts.schema,
          });
        } else if (req.type === "MUTATE") {
          if (!req.procedure)
            throw new Error("Procedure is required for mutations");
          const customProcedure = this.customMutations[req.procedure];

          if (customProcedure) {
            const validInput = customProcedure.inputValidator.parse(req.input);

            req.input = validInput;

            return customProcedure.handler({
              req,
              db: opts.db,
              schema: opts.schema,
            });
          } else if (req.procedure === "INSERT" || req.procedure === "UPDATE") {
            return this.handleSet({
              req: req as ParsedRequest<
                LiveObjectMutationInput<TResourceSchema>
              >,
              db: opts.db,
              schema: opts.schema,
              operation: req.procedure,
            });
          }
        }

        throw new Error("Invalid request");
      })();

    return await Array.from(this.middlewares.values()).reduceRight(
      (next, middleware) => {
        return (req) => middleware({ req, next });
      },
      (async (req) => next(req)) as NextFunction<any>
    )(opts.req);
  }

  public use(...middlewares: TMiddleware[]) {
    for (const middleware of middlewares) {
      this.middlewares.add(middleware);
    }
    return this;
  }

  public withMutations<
    T extends Record<string, Mutation<any, RequestHandler<any, any>>>,
  >(mutationFactory: (opts: { mutation: typeof mutationCreator }) => T) {
    return new Route<TResourceSchema, TMiddleware, T>(
      this.resourceName,
      mutationFactory({ mutation: mutationCreator })
    );
  }

  private handleFind: RequestHandler<never, QueryResult<TResourceSchema>> =
    async ({ req, db }) => {
      const authorizationWhereClause = this.authorization?.read?.(req.context);

      return {
        data: await db.rawFind<TResourceSchema>(
          req.resourceName,
          req.where && authorizationWhereClause
            ? { $and: [req.where, authorizationWhereClause] }
            : (authorizationWhereClause ?? req.where),
          req.include
        ),
        acceptedValues: null,
      };
    };

  private handleSet = async ({
    req,
    db,
    schema,
    operation,
  }: {
    req: ParsedRequest<LiveObjectMutationInput<TResourceSchema>>;
    db: Storage;
    schema: Schema<any>;
    operation: "INSERT" | "UPDATE";
  }): Promise<MutationResult<TResourceSchema>> => {
    if (!req.input) throw new Error("Payload is required");
    if (!req.resourceId) throw new Error("ResourceId is required");

    const target = await db.rawFindById<TResourceSchema>(
      req.resourceName,
      req.resourceId
    );

    if (operation === "INSERT" && target) {
      throw new Error("Resource already exists");
    } else if (operation === "UPDATE" && !target) {
      throw new Error("Resource not found");
    }

    return db.transaction(async ({ trx }) => {
      const [newRecord, acceptedValues] = schema[
        this.resourceName
      ].mergeMutation(
        "set",
        req.input as Record<string, MaterializedLiveType<LiveTypeAny>>,
        target
      );

      if (!acceptedValues) {
        throw new Error("Mutation rejected");
      }

      if (operation === "INSERT") {
        const result = await trx.rawInsert<TResourceSchema>(
          req.resourceName,
          req.resourceId!,
          newRecord
        );

        if (this.authorization?.insert) {
          const authorizationWhereClause = this.authorization.insert(
            req.context
          );
          const authorized = applyWhere(
            inferValue(result) as Record<string, any>,
            authorizationWhereClause
          );
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
        const authorizationWhereClause = this.authorization.update.preMutation(
          req.context
        );
        const authorized = applyWhere(
          inferValue(newRecord) as Record<string, any>,
          authorizationWhereClause
        );
        if (!authorized) {
          throw new Error("Not authorized");
        }
      }

      const result = await trx.rawUpdate<TResourceSchema>(
        req.resourceName,
        req.resourceId!,
        newRecord
      );

      if (this.authorization?.update?.postMutation) {
        const authorizationWhereClause = this.authorization.update.postMutation(
          req.context
        );
        const authorized = applyWhere(
          inferValue(result) as Record<string, any>,
          authorizationWhereClause
        );
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
      shape.name,
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
