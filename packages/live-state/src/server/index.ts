/** biome-ignore-all lint/suspicious/noExplicitAny: any's are actually used correctly */
import { QueryEngine } from "../core/query-engine";
import type { QueryStep as CoreQueryStep } from "../core/query-engine/types";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../core/schemas/core-protocol";
import type { PromiseOrSync } from "../core/utils";
import { mergeWhereClauses } from "../core/utils";
import { inferValue, type Schema, type WhereClause } from "../schema";
import { createLogger, type Logger, LogLevel } from "../utils";
import type { AnyRouter, QueryProcedureRequest, QueryResult, Route } from "./router";
import type { Storage } from "./storage";
import type { Batcher } from "./storage/batcher";

export * from "./adapters/express";
export * from "./router";
export * from "./storage";

export type { QueryProcedureRequest };

export interface BaseRequest {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  queryParams: Record<string, string>;
  context: Record<string, any>;
}

export interface QueryRequest extends BaseRequest, RawQueryRequest {
  type: "QUERY";
  /** @internal */
  relationalWhere?: WhereClause<any>;
}

export interface MutationRequest<TInput = any> extends BaseRequest {
  type: "MUTATE";
  input: TInput;
  resource: string;
  resourceId?: string;
  procedure: string;
}

export type Request = QueryRequest | MutationRequest | QueryProcedureRequest;

export type ContextProvider = (
  req: Omit<BaseRequest, "context"> & {
    transport: "HTTP" | "WEBSOCKET";
  }
) => Record<string, any>;

export type NextFunction<O, R = Request> = (req: R) => PromiseOrSync<O>;

export type Middleware<T = any> = (opts: {
  req: Request;
  next: NextFunction<T>;
}) => ReturnType<NextFunction<T>>;

export class Server<TRouter extends AnyRouter> {
  readonly router: TRouter;
  readonly storage: Storage;
  readonly schema: Schema<any>;
  readonly middlewares: Set<Middleware<any>> = new Set();
  readonly logger: Logger;

  contextProvider?: ContextProvider;

  /** @internal */
  readonly queryEngine: QueryEngine;

  private constructor(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema<any>;
    middlewares?: Middleware<any>[];
    contextProvider?: ContextProvider;
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

    this.storage.init(this.schema, this.logger, this);
    this.contextProvider = opts.contextProvider;

    this.queryEngine = new QueryEngine({
      router: {
        get: async (
          query: RawQueryRequest,
          extra?: { context?: any; batcher?: Batcher }
        ) => {
          const {
            headers,
            cookies,
            queryParams,
            context: ctx,
          } = extra?.context ?? {};

          if (!extra?.batcher) {
            throw new Error("Batcher is required");
          }

          const req: QueryRequest = {
            ...query,
            type: "QUERY",
            headers,
            cookies,
            queryParams,
            context: ctx,
          };

          const result = await (
            this.router.routes[query.resource] as
              | Route<any, any, any, any>
              | undefined
          )?.handleQuery({
            req,
            batcher: extra.batcher,
          });

          return result?.data ?? [];
        },
        incrementQueryStep: (step: CoreQueryStep, context: any = {}) => {
          const authorizationClause = (
            this.router.routes[step.query.resource] as
              | Route<any, any, any, any>
              | undefined
          )?.getAuthorizationClause({
            ...step.query,
            type: "QUERY",
            headers: context.headers,
            cookies: context.cookies,
            queryParams: context.queryParams,
            context: context.context,
          });

          if (
            typeof authorizationClause === "boolean" &&
            !authorizationClause
          ) {
            throw new Error("Not authorized");
          }

          const mergedWhere = mergeWhereClauses(
            step.query.where,
            typeof authorizationClause === "object"
              ? authorizationClause
              : undefined
          );

          return {
            ...step,
            query: {
              ...step.query,
              where: mergedWhere,
            },
          } satisfies CoreQueryStep;
        },
      },
      storage: this.storage,
      schema: this.schema,
      logger: this.logger,
    });
  }

  public static create<TRouter extends AnyRouter>(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema<any>;
    middlewares?: Middleware<any>[];
    contextProvider?: ContextProvider;
    logLevel?: LogLevel;
  }) {
    return new Server<TRouter>(opts);
  }

  public handleQuery(opts: {
    req: QueryRequest;
    subscription?: (mutation: DefaultMutation) => void;
  }): Promise<QueryResult<any>> {
    return this.wrapInMiddlewares(async (req: QueryRequest) => {
      const { headers, cookies, queryParams, context, ...rawQuery } = req;

      const ctx = {
        headers,
        cookies,
        queryParams,
        context,
      };

      const unsubscribe = opts.subscription
        ? this.queryEngine.subscribe(
            rawQuery,
            (mutation) => {
              opts.subscription?.(mutation);
            },
            ctx
          )
        : undefined;

      const data = await this.queryEngine.get(rawQuery, {
        context: ctx,
      });

      return {
        data,
        unsubscribe,
      };
    })(opts.req);
  }

  public async handleMutation(opts: { req: MutationRequest }): Promise<any> {
    const result = await this.wrapInMiddlewares(
      async (req: MutationRequest) => {
        const route = this.router.routes[req.resource] as
          | Route<any, any, any, any>
          | undefined;

        if (!route) {
          throw new Error("Invalid resource");
        }

        return route.handleMutation({
          req,
          db: this.storage,
          schema: this.schema,
        });
      }
    )(opts.req);

    return result;
  }

  public async handleCustomQuery(opts: {
    req: QueryProcedureRequest;
    subscription?: (mutation: DefaultMutation) => void;
  }): Promise<any> {
    const result = await this.wrapInMiddlewares(
      async (req: QueryProcedureRequest) => {
        const route = this.router.routes[req.resource] as
          | Route<any, any, any, any>
          | undefined;

        if (!route) {
          throw new Error("Invalid resource");
        }

        return route.handleCustomQuery({
          req,
          db: this.storage,
          schema: this.schema,
        });
      }
    )(opts.req);

    const isQueryBuilder =
      typeof result === "object" &&
      result !== null &&
      "buildQueryRequest" in result &&
      typeof (result as { buildQueryRequest?: unknown }).buildQueryRequest ===
        "function";

    if (!isQueryBuilder) {
      if (opts.subscription) {
        throw new Error(
          "Subscriptions require custom queries to return a QueryBuilder"
        );
      }
      return result;
    }

    const { headers, cookies, queryParams, context } = opts.req;
    const ctx = { headers, cookies, queryParams, context };
    const rawQuery = (result as { buildQueryRequest: () => RawQueryRequest })
      .buildQueryRequest();

    const unsubscribe = opts.subscription
      ? this.queryEngine.subscribe(
          rawQuery,
          (mutation) => {
            opts.subscription?.(mutation);
          },
          ctx
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

  public context(contextProvider: ContextProvider) {
    this.contextProvider = contextProvider;
    return this;
  }

  /** @internal */
  public notifySubscribers(mutation: DefaultMutation, entityData: any) {
    this.queryEngine.handleMutation(mutation, entityData);
  }

  private wrapInMiddlewares<T extends Request>(
    next: NextFunction<any, T>
  ): NextFunction<any, T> {
    return (req: T) =>
      Array.from(this.middlewares.values()).reduceRight(
        (next, middleware) => (req) =>
          middleware({ req, next: next as NextFunction<any, any> }),
        next
      )(req);
  }
}

export const server = Server.create;
