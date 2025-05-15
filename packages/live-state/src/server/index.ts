import { RawMutationRequest } from "../core/schemas/core-protocol";
import { Schema } from "../schema";
import { AnyRouter } from "./router";
import { Storage } from "./storage";

export * from "./router";
export * from "./storage";
export * from "./web-socket";

type InnerRequest = {
  headers: Record<string, string>;
  cookies: Record<string, string>;
};

type RequestBase = {
  req: InnerRequest;
  procedure?: string;
  resourceName: string;
  context: Record<string, any>;
  where?: Record<string, any>;
};

export type FindRequest = RequestBase & {
  type: "QUERY";
};

export type SetRequest = RequestBase & {
  type: "MUTATE";
  resourceId: string;
  payload: Record<string, any>;
};

export type Request = FindRequest | SetRequest;

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
      this.mutationSubscriptions.forEach((handler) => {
        handler({
          id: opts.req.context.messageId,
          type: "MUTATE",
          resource: opts.req.resourceName,
          payload: result.acceptedValues ?? {},
          resourceId: (opts.req as SetRequest).resourceId,
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
