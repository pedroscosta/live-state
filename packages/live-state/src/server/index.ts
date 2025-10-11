/** biome-ignore-all lint/suspicious/noExplicitAny: any's are actually used correctly */
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../core/schemas/core-protocol";
import type { Awaitable } from "../core/utils";
import { inferValue, type Schema, type WhereClause } from "../schema";
import type { AnyRouter, MutationResult, QueryResult, Route } from "./router";
import type { Storage } from "./storage";

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
  req: BaseRequest;
  next: NextFunction<T>;
}) => ReturnType<NextFunction<T>>;

export class Server<TRouter extends AnyRouter> {
  readonly router: TRouter;
  readonly storage: Storage;
  readonly schema: Schema<any>;
  readonly middlewares: Set<Middleware<any>> = new Set();

  contextProvider?: ContextProvider;

  private mutationSubscriptions: Set<MutationHandler> = new Set();

  private constructor(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema<any>;
    middlewares?: Middleware<any>[];
    contextProvider?: ContextProvider;
  }) {
    this.router = opts.router;
    this.storage = opts.storage;
    this.schema = opts.schema;
    opts.middlewares?.forEach((middleware) => {
      this.middlewares.add(middleware);
    });

    this.storage.updateSchema(this.schema);
    this.contextProvider = opts.contextProvider;
  }

  public static create<TRouter extends AnyRouter>(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema<any>;
    middlewares?: Middleware<any>[];
    contextProvider?: ContextProvider;
  }) {
    return new Server<TRouter>(opts);
  }

  public subscribeToMutations(handler: MutationHandler) {
    this.mutationSubscriptions.add(handler);

    return () => {
      this.mutationSubscriptions.delete(handler);
    };
  }

  public handleQuery(opts: { req: QueryRequest }): Promise<QueryResult<any>> {
    return this.wrapInMiddlewares(async (req: QueryRequest) => {
      console.log("req", req.include);
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

      console.log("queryPlan", queryPlan);

      const stepResults: Record<string, QueryStepResult[]> = {};

      for (let i = 0; i < queryPlan.length; i++) {
        const step = queryPlan[i];
        console.log("step index", step.stepId);
        console.log("resource", queryPlan[i].resource);
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

        console.log("wheres", wheres);

        const stepSettledResults = await Promise.allSettled(
          wheres.map(async (where, i) => {
            const ref = prevStepKeys?.[i];

            console.log("ref", ref);

            const result = await route.handleQuery({
              req: {
                type: "QUERY",
                ...step,
                ...sharedContext,
                where:
                  where && step.where
                    ? { $and: [step.where, where] }
                    : (where ?? step.where),
              },
              db: this.storage,
            });

            console.log(
              "result for step",
              step.stepId,
              JSON.stringify(result, null, 2)
            );

            return {
              reference: ref,
              result,
            };
          })
        );

        console.log(
          "stepSettledResults",
          JSON.stringify(stepSettledResults, null, 2)
        );

        const results = stepSettledResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : []
        );

        stepResults[step.stepId] = results;
      }

      console.log("result", JSON.stringify(stepResults, null, 2));

      const flattenedResults = Object.fromEntries(
        Object.entries(stepResults).flatMap(([stepPath, results], i) =>
          results.flatMap((result) =>
            Object.entries(result.result.data).map(([id, data]) => [
              id,
              {
                data,
                references: result.reference,
                path: stepPath.split(".").slice(-1)[0],
                isMany: queryPlan[i].isMany,
                collectionName: queryPlan[i].collectionName,
                included: queryPlan[i].included,
              },
            ])
          )
        )
      );

      console.log(
        "flattenedResults",
        JSON.stringify(flattenedResults, null, 2)
      );

      const results = Object.keys(flattenedResults).reduceRight(
        (acc, id) => {
          const result = flattenedResults[id];
          const path = result.path;
          console.log("path", path);

          if (path === "query") {
            acc.data[id] = result.data;
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

          if (result.references) {
            console.log("result.references", result.references);

            if (result.isMany) {
              flattenedResults[result.references].data.value[path] ??= {
                value: [],
              };
              flattenedResults[result.references].data.value[path].value.push(
                result.data
              );
            } else {
              flattenedResults[result.references].data.value[path] =
                result.data;
            }
          }

          console.log("acc", JSON.stringify(acc, null, 2));

          return acc;
        },
        {
          data: {},
        } as QueryResult<any>
      );

      console.log(
        "infered result",
        Object.entries(results.data).map(([key, value]) => ({
          ...inferValue(value as any),
          id: key,
        }))
      );

      return results;
    })(opts.req);
  }

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

      if (Object.keys(acceptedValues).length) {
        // TODO refactor this to be called by the storage instead of the server
        this.mutationSubscriptions.forEach((handler) => {
          handler({
            id: opts.req.context.messageId,
            type: "MUTATE",
            resource: req.resource,
            payload: acceptedValues,
            resourceId: req.resourceId!,
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
  reference?: string;
  result: QueryResult<any>;
}

function getQuerySteps(
  req: QueryRequest,
  schema: Schema<any>,
  opts: Omit<QueryStep, keyof Omit<RawQueryRequest, "include">>
) {
  const { include, ...rest } = req;
  const { stepId } = opts;

  console.log("include", include);

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

        console.log("relation.foreignColumn", relation.foreignColumn);
        console.log("relation.relationalColumn", relation.relationalColumn);

        return getQuerySteps(
          { ...rest, resource: otherResourceName, include },
          schema,
          {
            // TODO handle type === "many"
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
