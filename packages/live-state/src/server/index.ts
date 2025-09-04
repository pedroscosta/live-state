import type { RawMutationRequest } from "../core/schemas/core-protocol";
import type { Schema } from "../schema";
import type { AnyRouter } from "./router";
import type { Storage } from "./storage";

export * from "./adapters/express";
export * from "./router";
export * from "./storage";

export type ParsedRequest<TInput = any> = {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  query: Record<string, string>;
  resourceName: string;
  procedure?: string;
  context: Record<string, any>;
  where?: Record<string, any>;
  include?: Record<string, any>;
  type: "QUERY" | "MUTATE";
  resourceId?: string;
  input?: TInput;
};

export type ContextProvider = (
  req: Pick<ParsedRequest, "headers" | "cookies" | "query"> & {
    transport: "HTTP" | "WEBSOCKET";
  }
) => Record<string, any>;

export type RequestType = ParsedRequest["type"];

export type MutationHandler = (mutation: RawMutationRequest) => void;

export type NextFunction<T> = (req: ParsedRequest) => Promise<T> | T;

export type Middleware<T = any> = (opts: {
  req: ParsedRequest;
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

  public async handleRequest(opts: { req: ParsedRequest }) {
    if (!this.router.routes[opts.req.resourceName]) {
      throw new Error("Invalid resource");
    }

    const result = await Array.from(this.middlewares.values()).reduceRight(
      (next, middleware) => {
        return (req) => middleware({ req, next });
      },
      (async (req) =>
        this.router.routes[opts.req.resourceName]!.handleRequest({
          req,
          db: this.storage,
          schema: this.schema,
        })) as NextFunction<any>
    )(opts.req);

    if (
      result &&
      opts.req.type === "MUTATE" &&
      result.acceptedValues &&
      Object.keys(result.acceptedValues).length > 0
    ) {
      // TODO refactor this to be called by the storage instead of the server
      this.mutationSubscriptions.forEach((handler) => {
        handler({
          id: opts.req.context.messageId,
          type: "MUTATE",
          resource: opts.req.resourceName,
          payload: result.acceptedValues ?? {},
          resourceId: opts.req.resourceId!,
        });
      });
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
}

export const server = Server.create;
