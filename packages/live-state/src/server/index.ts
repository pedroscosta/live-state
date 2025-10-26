/** biome-ignore-all lint/suspicious/noExplicitAny: any's are actually used correctly */
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../core/schemas/core-protocol";
import type { Awaitable } from "../core/utils";
import type { Schema, WhereClause } from "../schema";
import { createLogger, type Logger, LogLevel } from "../utils";
import type { AnyRouter, MutationResult, QueryResult, Route } from "./router";
import type { Storage } from "./storage";
import { Batcher } from "./storage/batcher";

export * from "./adapters/express";
export * from "./router";
export * from "./storage";

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

export type Request = QueryRequest | MutationRequest;

export type ContextProvider = (
  req: Omit<BaseRequest, "context"> & {
    transport: "HTTP" | "WEBSOCKET";
  }
) => Record<string, any>;

export type MutationHandler = (mutation: DefaultMutation) => void;

export type NextFunction<O, R = Request> = (req: R) => Awaitable<O>;

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

  private mutationSubscriptions: Set<MutationHandler> = new Set();

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

    this.storage.init(this.schema, this.logger);
    this.contextProvider = opts.contextProvider;
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

  /** @internal @deprecated */
  public subscribeToMutations(handler: MutationHandler) {
    this.mutationSubscriptions.add(handler);

    return () => {
      this.mutationSubscriptions.delete(handler);
    };
  }

  /** @internal */
  public handleQuery(opts: { req: QueryRequest }): Promise<QueryResult<any>> {
    const batcher = new Batcher(this.storage);

    return this.wrapInMiddlewares(async (req: QueryRequest) => {
      const queryPlan = getQuerySteps(req, this.schema, {
        stepId: "query",
        collectionName: req.resource,
        included: Object.keys(req.include ?? {}),
      });
      const sharedContext = {
        headers: req.headers,
        cookies: req.cookies,
        queryParams: req.queryParams,
        context: req.context,
      };

      const stepResults: Record<string, QueryStepResult[]> = {};

      for (let i = 0; i < queryPlan.length; i++) {
        const step = queryPlan[i];
        const route = this.router.routes[step.resource] as
          | Route<any, any, any>
          | undefined;

        if (!route) {
          throw new Error("Invalid resource");
        }

        const wheres =
          step.getWhere && step.referenceGetter
            ? step.referenceGetter(stepResults).map(step.getWhere)
            : [undefined];

        const prevStepKeys = stepResults[step.prevStepId ?? ""]?.flatMap(
          (result) => Object.keys(result?.result?.data ?? {})
        );

        const stepSettledResults = await Promise.allSettled(
          wheres.map(async (where, i) => {
            const includedBy = prevStepKeys?.[i];

            const result = await route.handleQuery({
              req: {
                type: "QUERY",
                ...step,
                ...sharedContext,
                where: step.where,
                relationalWhere: where,
              },
              batcher,
            });

            return {
              includedBy,
              result,
            } satisfies QueryStepResult;
          })
        );

        const results = stepSettledResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : []
        );

        stepResults[step.stepId] = results;
      }

      const flattenedResults = Object.fromEntries(
        Object.entries(stepResults).flatMap(([stepPath, results], i) =>
          results.flatMap((result) =>
            Object.entries(result.result.data).map(([id, data]) => [
              `${stepPath}.${id}`,
              {
                data,
                includedBy:
                  stepPath !== "query" && result.includedBy
                    ? `${stepPath.split(".").slice(0, -1).join(".")}.${result.includedBy}`
                    : undefined,
                path: stepPath.split(".").slice(-1)[0],
                isMany: queryPlan[i].isMany,
                collectionName: queryPlan[i].collectionName,
                included: queryPlan[i].included,
              },
            ])
          )
        )
      );

      const results = Object.keys(flattenedResults).reduceRight(
        (acc, id) => {
          const result = flattenedResults[id];
          const path = result.path;

          if (path === "query") {
            acc.data[id.replace("query.", "")] = result.data;
          }

          if (result.included.length) {
            for (const included of result.included) {
              result.data.value[included] ??=
                this.schema[result.collectionName]?.relations[included]
                  ?.type === "many"
                  ? { value: [] }
                  : { value: null };
            }
          }

          if (result.includedBy) {
            const parentResult = flattenedResults[result.includedBy];

            if (!parentResult) return acc;

            if (result.isMany) {
              parentResult.data.value[path] ??= {
                value: [],
              };
              parentResult.data.value[path].value.push(result.data);
            } else {
              parentResult.data.value[path] = result.data;
            }
          }

          return acc;
        },
        {
          data: {},
        } as QueryResult<any>
      );

      return results;
    })(opts.req);
  }

  /** @internal */
  public async handleMutation(opts: { req: MutationRequest }): Promise<any> {
    const result = await this.wrapInMiddlewares(
      async (req: MutationRequest) => {
        const route = this.router.routes[req.resource] as
          | Route<any, any, any>
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

    if (
      result &&
      opts.req.type === "MUTATE" &&
      result.acceptedValues &&
      (opts.req.procedure === "INSERT" || opts.req.procedure === "UPDATE") &&
      opts.req.resourceId
    ) {
      const mutationResult = result as MutationResult<any>;
      const acceptedValues = mutationResult.acceptedValues ?? {};
      const req = opts.req as MutationRequest;
      const resourceId = req.resourceId;

      if (Object.keys(acceptedValues).length && resourceId) {
        // TODO refactor this to be called by the storage instead of the server
        this.mutationSubscriptions.forEach((handler) => {
          handler({
            id: opts.req.context.messageId,
            type: "MUTATE",
            resource: req.resource,
            payload: acceptedValues,
            resourceId,
            procedure: req.procedure as "INSERT" | "UPDATE",
          });
        });
      }
    }

    return result;
  }

  public use(middleware: Middleware<any>) {
    this.middlewares.add(middleware);
    return this;
  }

  public context(contextProvider: ContextProvider) {
    this.contextProvider = contextProvider;
    return this;
  }

  public getStorage() {
    return this.storage;
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

interface QueryStep extends Omit<RawQueryRequest, "include"> {
  stepId: string;
  prevStepId?: string;
  getWhere?: (id: string) => WhereClause<any>;
  referenceGetter?: (
    prevResults: Record<string, QueryStepResult[]>
  ) => string[];
  isMany?: boolean;
  collectionName: string;
  included: string[];
}

interface QueryStepResult {
  includedBy?: string;
  result: QueryResult<any>;
}

function getQuerySteps(
  req: QueryRequest,
  schema: Schema<any>,
  opts: Omit<QueryStep, keyof Omit<RawQueryRequest, "include">>
) {
  const { include, ...rest } = req;
  const { stepId } = opts;

  const queryPlan: QueryStep[] = [{ ...rest, ...opts }];

  if (
    include &&
    typeof include === "object" &&
    Object.keys(include).length > 0
  ) {
    const resourceSchema = schema[rest.resource];

    if (!resourceSchema) throw new Error(`Resource ${rest.resource} not found`);

    queryPlan.push(
      ...Object.entries(include).flatMap(([relationName, include]) => {
        const relation = resourceSchema.relations[relationName];

        if (!relation)
          throw new Error(
            `Relation ${relationName} not found for resource ${rest.resource}`
          );

        const otherResourceName = relation.entity.name;

        return getQuerySteps(
          { ...rest, resource: otherResourceName, include },
          schema,
          {
            getWhere:
              relation.type === "one"
                ? (id) => ({ id })
                : (id) => ({ [relation.foreignColumn]: id }),
            referenceGetter: (prevResults) =>
              prevResults[stepId].flatMap((result) =>
                result.result.data
                  ? relation.type === "one"
                    ? Object.values(result.result.data).map(
                        (v) => v.value?.[relation.relationalColumn]?.value
                      )
                    : Object.keys(result.result.data)
                  : []
              ),
            stepId: `${stepId}.${relationName}`,
            prevStepId: stepId,
            isMany: relation.type === "many",
            collectionName: otherResourceName,
            included: typeof include === "object" ? Object.keys(include) : [],
          }
        );
      })
    );
  }

  return queryPlan;
}
