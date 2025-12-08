/** biome-ignore-all lint/suspicious/noExplicitAny: any's are actually used correctly */
import { QueryEngine } from "../core/query-engine";
import type { QueryStep as CoreQueryStep } from "../core/query-engine/types";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../core/schemas/core-protocol";
import type { PromiseOrSync } from "../core/utils";
import { mergeWhereClauses } from "../core/utils";
import type { LiveObjectAny, Schema, WhereClause } from "../schema";
import { inferValue } from "../schema";
import {
  applyWhere,
  createLogger,
  hash,
  type Logger,
  LogLevel,
} from "../utils";
import type { AnyRouter, QueryResult, Route } from "./router";
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
interface CollectionSubscription {
  callbacks: Set<MutationHandler>;
  query: RawQueryRequest;
  authorizationWhere?: WhereClause<any>;
}

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

  private collectionSubscriptions: Map<
    string,
    Map<string, CollectionSubscription>
  > = new Map();

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
              | Route<any, any, any>
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
              | Route<any, any, any>
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
    testNewEngine?: boolean;
  }): Promise<QueryResult<any>> {
    if (opts.testNewEngine) {
      const { headers, cookies, queryParams, context, ...rawQuery } = opts.req;

      const unsubscribe = opts.subscription
        ? this.queryEngine.subscribe(rawQuery, (mutation) => {
            opts.subscription?.(mutation);
          })
        : undefined;

      return new Promise((resolve) => {
        this.queryEngine
          .get(rawQuery, {
            context: {
              headers,
              cookies,
              queryParams,
              context,
            },
          })
          .then((data) => {
            resolve({
              data,
              unsubscribe,
            });
          });
      });
    }

    const batcher = new Batcher(this.storage);

    return this.wrapInMiddlewares(async (req: QueryRequest) => {
      const queryPlan = getQuerySteps(req, this.schema, {
        stepId: "query",
        collectionName: req.resource,
        included: Object.keys(req.include ?? {}),
      });

      const unsubscribeFunctions: (() => void)[] = [];

      const sharedContext = {
        headers: req.headers,
        cookies: req.cookies,
        queryParams: req.queryParams,
        context: req.context,
      };

      const stepResults: Record<string, QueryStepResult[]> = {};
      const stepQueryHashes: Record<string, string | undefined> = {};

      for (let i = 0; i < queryPlan.length; i++) {
        const step = queryPlan[i];
        const route = this.router.routes[step.resource] as
          | Route<any, any, any>
          | undefined;

        if (!route) {
          throw new Error("Invalid resource");
        }

        let wheres: (WhereClause<any> | undefined)[];

        if (step.getWhere && step.referenceGetter) {
          const referenceIds = step.referenceGetter(stepResults);
          wheres = [];
          for (let j = 0; j < referenceIds.length; j++) {
            wheres.push(step.getWhere(referenceIds[j]));
          }
        } else {
          wheres = [undefined];
        }

        const prevStepResults = stepResults[step.prevStepId ?? ""];
        const prevStepKeys: string[] = [];
        if (prevStepResults) {
          for (let j = 0; j < prevStepResults.length; j++) {
            const result = prevStepResults[j];
            const dataArray = result?.result?.data ?? [];
            for (let k = 0; k < dataArray.length; k++) {
              const item = dataArray[k];
              const id = item?.value?.id?.value as string | undefined;
              if (id) {
                prevStepKeys.push(id);
              }
            }
          }
        }

        // Extract relation name from stepId if it's a child query
        // stepId format is "${parentStepId}.${relationName}" for child queries
        const parentRelationName = step.prevStepId
          ? step.stepId.split(".").pop()
          : undefined;

        const promises = [];
        for (let j = 0; j < wheres.length; j++) {
          const where = wheres[j];
          const includedBy = prevStepKeys[j];
          promises.push(
            (async () => {
              const query: QueryRequest = {
                type: "QUERY",
                ...step,
                ...sharedContext,
                where: step.where,
                relationalWhere: where,
              };

              const result = await route.handleQuery({
                req: query,
                batcher,
              });

              return {
                includedBy,
                result,
              } satisfies QueryStepResult;
            })()
          );
        }

        const stepSettledResults = await Promise.allSettled(promises);

        const results: QueryStepResult[] = [];
        for (let j = 0; j < stepSettledResults.length; j++) {
          const settled = stepSettledResults[j];
          if (settled.status === "fulfilled") {
            results.push(settled.value);
          }
        }

        stepResults[step.stepId] = results;
      }

      const entriesMap = new Map<
        string,
        {
          data: any;
          includedBy: Set<string>;
          path: string;
          isMany: boolean;
          collectionName: string;
          included: string[];
        }
      >();

      let stepIndex = 0;
      for (const stepPath in stepResults) {
        const results = stepResults[stepPath];
        const step = queryPlan[stepIndex];
        stepIndex++;

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const dataArray = result.result.data;

          for (let k = 0; k < dataArray.length; k++) {
            const data = dataArray[k];
            const id = data?.value?.id?.value as string | undefined;
            if (!id) continue;

            const key = `${stepPath}.${id}`;

            let parentKeys: string[] = [];
            if (stepPath !== "query" && result.includedBy) {
              parentKeys = [`${step.prevStepId}.${result.includedBy}`];
            }

            const existing = entriesMap.get(key);
            if (existing) {
              for (let l = 0; l < parentKeys.length; l++) {
                existing.includedBy.add(parentKeys[l]);
              }
            } else {
              entriesMap.set(key, {
                data,
                includedBy: new Set(parentKeys),
                path: stepPath.split(".").slice(-1)[0],
                isMany: step.isMany ?? false,
                collectionName: step.collectionName,
                included: step.included,
              });
            }
          }
        }
      }

      const flattenedResults = Object.fromEntries(entriesMap);

      const acc: QueryResult<any> = {
        data: [],
      };

      const flattenedKeys = Object.keys(flattenedResults);
      for (let i = flattenedKeys.length - 1; i >= 0; i--) {
        const id = flattenedKeys[i];
        const result = flattenedResults[id];
        const path = result.path;

        if (path === "query") {
          acc.data.push(result.data);
        }

        if (result.included.length) {
          for (let j = 0; j < result.included.length; j++) {
            const included = result.included[j];
            result.data.value[included] ??=
              this.schema[result.collectionName]?.relations[included]?.type ===
              "many"
                ? { value: [] }
                : { value: null };
          }
        }

        if (result.includedBy.size > 0) {
          const parentKeysArray = Array.from(result.includedBy);
          for (let j = 0; j < parentKeysArray.length; j++) {
            const parentKey = parentKeysArray[j];
            const parentResult = flattenedResults[parentKey];

            if (!parentResult) continue;

            if (result.isMany) {
              parentResult.data.value[path] ??= {
                value: [],
              };
              parentResult.data.value[path].value.push(result.data);
            } else {
              parentResult.data.value[path] = result.data;
            }
          }
        }
      }

      const results = acc;

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
          schema: this.schema,
        });
      }
    )(opts.req);

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

  /** @internal @deprecated */
  public subscribeToMutations(
    query: RawQueryRequest,
    handler: MutationHandler,
    authorizationWhere?: WhereClause<any>
  ) {
    const resource = query.resource;
    const subscriptionConditions = {
      query,
      authorizationWhere,
    };
    const key = hash(subscriptionConditions);

    let resourceSubscriptions = this.collectionSubscriptions.get(resource);

    if (!resourceSubscriptions) {
      resourceSubscriptions = new Map();
      this.collectionSubscriptions.set(resource, resourceSubscriptions);
    }

    const existing = resourceSubscriptions.get(key);

    if (existing) {
      existing.callbacks.add(handler);
      if (authorizationWhere !== undefined) {
        existing.authorizationWhere = authorizationWhere;
      }
    } else {
      resourceSubscriptions.set(key, {
        callbacks: new Set([handler]),
        ...subscriptionConditions,
      });
    }

    return () => {
      const resourceSubscription = this.collectionSubscriptions.get(resource);
      if (resourceSubscription) {
        resourceSubscription.get(key)?.callbacks.delete(handler);

        if (resourceSubscription.get(key)?.callbacks.size === 0) {
          resourceSubscription.delete(key);
        }
      }
    };
  }

  /** @internal */
  public notifySubscribers(mutation: DefaultMutation, entityData: any) {
    this.queryEngine.handleMutation(mutation, entityData);
    // TODO remove this once the query engine is used for subscriptions
    const resource = mutation.resource;
    const resourceSubscriptions = this.collectionSubscriptions.get(resource);
    if (!resourceSubscriptions) return;

    if (!entityData) return;

    for (const subscription of Array.from(resourceSubscriptions.values())) {
      const subscriptionWhere = extractFirstLevelWhere(
        subscription.query.where,
        this.schema[resource]
      );

      const mergedWhereResult = mergeWhereClauses(
        subscriptionWhere,
        subscription.authorizationWhere
      );

      const entityValue = inferValue(entityData);
      if (!entityValue) continue;

      if (
        mutation.resourceId &&
        typeof entityValue === "object" &&
        entityValue !== null &&
        !("id" in entityValue)
      ) {
        (entityValue as any).id = mutation.resourceId;
      } else if (
        mutation.resourceId &&
        typeof entityValue === "object" &&
        entityValue !== null &&
        (entityValue as any).id !== mutation.resourceId
      ) {
        (entityValue as any).id = mutation.resourceId;
      }

      const hasWhereClause = Object.keys(mergedWhereResult).length > 0;

      let matches = true;
      if (hasWhereClause) {
        matches = applyWhere(
          entityValue,
          mergedWhereResult as WhereClause<LiveObjectAny>
        );
      }

      if (matches) {
        subscription.callbacks.forEach((handler) => {
          try {
            handler(mutation);
          } catch (error) {
            this.logger?.error(
              `Error in mutation subscription for resource ${resource}:`,
              error
            );
          }
        });
      }
    }
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
  const { include, where, ...rest } = req;
  const { stepId } = opts;

  const queryPlan: QueryStep[] = [{ ...rest, ...opts, where }];

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
              prevResults[stepId].flatMap((result) => {
                const dataArray = result.result.data ?? [];
                if (relation.type === "one") {
                  return dataArray
                    .map((v) => v.value?.[relation.relationalColumn]?.value)
                    .filter((v): v is string => v !== undefined);
                } else {
                  return dataArray
                    .map((v) => v.value?.id?.value as string | undefined)
                    .filter((v): v is string => v !== undefined);
                }
              }),
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

function extractFirstLevelWhere<T extends LiveObjectAny>(
  where: WhereClause<T> | undefined,
  resourceSchema: T | undefined
): WhereClause<T> | undefined {
  if (!where || !resourceSchema) return where;
  if (Object.keys(where).length === 0) return where;

  if (where.$and) {
    const filteredAnd = (where.$and as WhereClause<T>[])
      .map((w: WhereClause<T>) => extractFirstLevelWhere(w, resourceSchema))
      .filter((w): w is WhereClause<T> => !!w && Object.keys(w).length > 0);
    if (filteredAnd.length === 0) return undefined;
    if (filteredAnd.length === 1) return filteredAnd[0];
    return { $and: filteredAnd } as WhereClause<T>;
  }

  if (where.$or) {
    const filteredOr = (where.$or as WhereClause<T>[])
      .map((w: WhereClause<T>) => extractFirstLevelWhere(w, resourceSchema))
      .filter((w): w is WhereClause<T> => !!w && Object.keys(w).length > 0);
    if (filteredOr.length === 0) return undefined;
    if (filteredOr.length === 1) return filteredOr[0];
    return { $or: filteredOr } as WhereClause<T>;
  }

  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(where)) {
    if (resourceSchema.fields[key]) {
      filtered[key] = value;
    }
  }

  return Object.keys(filtered).length > 0
    ? (filtered as WhereClause<T>)
    : undefined;
}
