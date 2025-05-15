import { RawMutationRequest } from "../core/schemas/core-protocol";
import { Schema } from "../schema";
import { AnyRouter } from "./router";
import { Storage } from "./storage";

export * from "./router";
export * from "./storage";
export * from "./web-socket";

export type Request<TInput = any> = {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  resourceName: string;
  procedure?: string;
  context: Record<string, any>;
  where?: Record<string, any>;
  type: "QUERY" | "MUTATE";
  resourceId?: string;
  input?: TInput;
};

export type RequestType = Request["type"];

export type MutationHandler = (mutation: RawMutationRequest) => void;

export type NextFunction<T> = (req: Request) => Promise<T> | T;

export type Middleware<T> = (opts: {
  req: Request;
  next: NextFunction<T>;
}) => ReturnType<NextFunction<T>>;

export class Server<TRouter extends AnyRouter> {
  readonly router: TRouter;
  readonly storage: Storage;
  readonly schema: Schema<any>;
  readonly middlewares: Set<Middleware<any>> = new Set();

  private mutationSubscriptions: Set<MutationHandler> = new Set();

  private constructor(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema<any>;
  }) {
    this.router = opts.router;
    this.storage = opts.storage;
    this.schema = opts.schema;

    this.storage.updateSchema(this.schema);
  }

  public static create<TRouter extends AnyRouter>(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema<any>;
  }) {
    return new Server<TRouter>(opts);
  }

  public subscribeToMutations(handler: MutationHandler) {
    this.mutationSubscriptions.add(handler);

    return () => {
      this.mutationSubscriptions.delete(handler);
    };
  }

  public async handleRequest(opts: { req: Request }) {
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
}

export const server = Server.create;

////////////////////////////// TESTING
