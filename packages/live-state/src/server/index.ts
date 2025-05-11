import { nanoid } from "nanoid";
import { MutationMessage } from "../core/internals";
import { LiveObjectAny, Schema } from "../schema";
import { AnyRouter, RouteResult } from "./router";
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
  resourceName: string;
  context: Record<string, any>;
  where?: Record<string, any>;
};

export type FindRequest = RequestBase & {
  type: "FIND";
};

export type SetRequest = RequestBase & {
  type: "SET";
  resourceId: string;
  payload: Record<string, any>;
};

export type Request = FindRequest | SetRequest;

export type RequestType = Request["type"];

export type MutationHandler = (mutation: MutationMessage) => void;

export type NextFunction = (
  req: Request
) => Promise<RouteResult<LiveObjectAny>> | RouteResult<LiveObjectAny>;

export type Middleware = (opts: {
  req: Request;
  next: NextFunction;
}) => ReturnType<NextFunction>;

export class Server<TRouter extends AnyRouter> {
  readonly router: TRouter;
  readonly storage: Storage;
  readonly schema: Schema<any>;
  readonly middlewares: Set<Middleware> = new Set();

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
        })) as NextFunction
    )(opts.req);

    if (
      result &&
      opts.req.type === "SET" &&
      result.acceptedValues &&
      Object.keys(result.acceptedValues).length > 0
    ) {
      this.mutationSubscriptions.forEach((handler) => {
        handler({
          _id: opts.req.context.messageId ?? nanoid(),
          type: "MUTATE",
          resource: opts.req.resourceName,
          payload: result.acceptedValues ?? {},
          resourceId: (opts.req as SetRequest).resourceId,
        });
      });
    }

    return result;
  }

  public use(middleware: Middleware) {
    this.middlewares.add(middleware);
    return this;
  }
}

export const server = Server.create;

////////////////////////////// TESTING
