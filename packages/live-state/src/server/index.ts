import { nanoid } from "nanoid";
import { MutationMessage } from "../core/internals";
import { LiveObjectAny, Schema } from "../schema";
import { Storage } from "./storage";

export * from "./web-socket";

export type RequestType = "FIND" | "INSERT" | "UPDATE" | "DELETE";
export type Request = {
  type: RequestType;
  resourceName: string;
  payload?: Record<string, any>;
  where?: Record<string, any>;
  resourceId?: string;
  messageId?: string;
};

export type RouteRecord<
  T extends Record<string, Route<LiveObjectAny>> = Record<
    string,
    Route<LiveObjectAny>
  >,
> = T;

export class Router<TRoutes extends RouteRecord> {
  readonly routes: TRoutes;

  private constructor(opts: { routes: TRoutes }) {
    this.routes = opts.routes;
  }

  public static create<TRoutes extends RouteRecord>(opts: { routes: TRoutes }) {
    return new Router<TRoutes>(opts);
  }
}

export const router = <TRoutes extends RouteRecord>(opts: {
  routes: TRoutes;
}) => Router.create({ ...opts });

export type AnyRouter = Router<RouteRecord>;

export class Route<TShape extends LiveObjectAny> {
  readonly shape: TShape;

  public constructor(shape: TShape) {
    this.shape = shape;
  }

  private handleFind(opts: { req: Request; db: Storage }) {
    return opts.db.find<TShape>(opts.req.resourceName, opts.req.where);
  }

  private handleInsert(opts: { req: Request; db: Storage }) {
    if (!opts.req.payload) throw new Error("Payload is required");

    const newRecord = this.shape.decode("insert", opts.req.payload);

    return opts.db.insert<TShape>(opts.req.resourceName, newRecord);
  }

  private async handleUpdate(opts: { req: Request; db: Storage }) {
    if (!opts.req.payload) throw new Error("Payload is required");
    if (!opts.req.resourceId) throw new Error("ResourceId is required");

    const target = await opts.db.findById<TShape>(
      opts.req.resourceName,
      opts.req.resourceId
    );

    if (!target) throw new Error("Target not found");

    const newRecord = this.shape.decode("update", opts.req.payload, target);

    return opts.db.update<TShape>(
      opts.req.resourceName,
      opts.req.resourceId,
      newRecord
    );
  }

  public async handleRequest(opts: { req: Request; db: Storage }) {
    switch (opts.req.type) {
      case "FIND":
        return this.handleFind(opts);
      case "INSERT":
        return this.handleInsert(opts);
      case "UPDATE":
        return this.handleUpdate(opts);
      default:
        throw new Error("Invalid request type");
    }
  }
}

export const routeFactory = () => {
  return <T extends LiveObjectAny>(shape: T) => new Route<T>(shape);
};

export type AnyRoute = Route<LiveObjectAny>;

export type ClientId = string;

export type MutationHandler = (mutation: MutationMessage) => void;

export class Server<TRouter extends AnyRouter> {
  readonly router: TRouter;
  readonly storage: Storage;
  readonly schema: Schema;

  private mutationSubscriptions: Set<MutationHandler> = new Set();

  private constructor(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema;
  }) {
    this.router = opts.router;
    this.storage = opts.storage;
    this.schema = opts.schema;

    this.storage.updateSchema(this.schema);
  }

  public static create<TRouter extends AnyRouter>(opts: {
    router: TRouter;
    storage: Storage;
    schema: Schema;
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
    const result = await this.router.routes[
      opts.req.resourceName
    ]?.handleRequest({
      req: opts.req,
      db: this.storage,
    });

    if (result && opts.req.payload) {
      // TODO handle partial updates
      this.mutationSubscriptions.forEach((handler) => {
        handler({
          _id: opts.req.messageId ?? nanoid(),
          type: "MUTATE",
          resource: opts.req.resourceName,
          mutationType:
            opts.req.type.toLowerCase() as MutationMessage["mutationType"],
          payload: opts.req.payload!,
          resourceId:
            opts.req.resourceId ??
            (result.value as unknown as { id: { value: string } }).id.value,
        });
      });
    }

    return result;
  }
}

export const server = Server.create;

////////////////////////////// TESTING
