/** biome-ignore-all lint/suspicious/noExplicitAny: any's are actually used correctly */
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../core/schemas/core-protocol";
import type { Awaitable } from "../core/utils";
import type { Schema } from "../schema";
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
  next: NextFunction<T, MutationRequest>;
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
      const route = this.router.routes[req.resource] as
        | Route<any, any, any>
        | undefined;

      if (!route) {
        throw new Error("Invalid resource");
      }

      return route.handleQuery({
        req,
        db: this.storage,
      });
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
      const req = opts.req as MutationRequest;

      if (Object.keys(result.acceptedValues).length) {
        // TODO refactor this to be called by the storage instead of the server
        this.mutationSubscriptions.forEach((handler) => {
          handler({
            id: opts.req.context.messageId,
            type: "MUTATE",
            resource: req.resource,
            payload: result.acceptedValues ?? {},
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
