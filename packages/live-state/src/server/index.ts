import { nanoid } from "nanoid";
import { MutationMessage } from "../core/internals";
import { LiveObjectAny, MaterializedLiveType, Schema } from "../schema";
import { Storage } from "./storage";

export * from "./storage";
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

// TODO check if this can be a fixed type
export type RouteRecord = Record<string, Route<LiveObjectAny>>;

export class Router<TSchema extends Schema<any>, TRoutes extends RouteRecord> {
  readonly routes: TRoutes;

  private constructor(opts: { routes: TRoutes }) {
    this.routes = opts.routes;
  }

  public static create<
    TSchema extends Schema<any>,
    TRoutes extends RouteRecord,
  >(opts: { routes: TRoutes }) {
    return new Router<TSchema, TRoutes>(opts);
  }
}

export const router = <
  TSchema extends Schema<any>,
  TRoutes extends Record<keyof TSchema, Route<LiveObjectAny>>,
>(opts: {
  schema: TSchema;
  routes: TRoutes;
}) => Router.create({ ...opts });

export type AnyRouter = Router<Schema<any>, RouteRecord>;

type RouteResult<TShape extends LiveObjectAny> = {
  data:
    | MaterializedLiveType<TShape>
    | Record<string, MaterializedLiveType<TShape>>;
  acceptedValues: Record<string, any> | null;
};

export class Route<TShape extends LiveObjectAny> {
  readonly shape: TShape;

  public constructor(shape: TShape) {
    this.shape = shape;
  }

  private async handleFind(opts: {
    req: Request;
    db: Storage;
  }): Promise<RouteResult<TShape>> {
    return {
      data: await opts.db.find<TShape>(opts.req.resourceName, opts.req.where),
      acceptedValues: null,
    };
  }

  private async handleInsert(opts: {
    req: Request;
    db: Storage;
  }): Promise<RouteResult<TShape>> {
    if (!opts.req.payload) throw new Error("Payload is required");

    const [newRecord, acceptedValues] = this.shape.mergeMutation(
      "insert",
      opts.req.payload
    );

    return {
      data: await opts.db.insert<TShape>(opts.req.resourceName, newRecord),
      acceptedValues,
    };
  }

  private async handleUpdate(opts: {
    req: Request;
    db: Storage;
  }): Promise<RouteResult<TShape>> {
    if (!opts.req.payload) throw new Error("Payload is required");
    if (!opts.req.resourceId) throw new Error("ResourceId is required");

    const target = await opts.db.findById<TShape>(
      opts.req.resourceName,
      opts.req.resourceId
    );

    if (!target) throw new Error("Target not found");

    const [newRecord, acceptedValues] = this.shape.mergeMutation(
      "update",
      opts.req.payload,
      target
    );

    if (!acceptedValues)
      return {
        data: target,
        acceptedValues: null,
      };

    return {
      data: await opts.db.update<TShape>(
        opts.req.resourceName,
        opts.req.resourceId,
        newRecord
      ),
      acceptedValues,
    };
  }

  public async handleRequest(opts: {
    req: Request;
    db: Storage;
  }): Promise<RouteResult<TShape>> {
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
  readonly schema: Schema<any>;

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
    const result = await this.router.routes[
      opts.req.resourceName
    ]?.handleRequest({
      req: opts.req,
      db: this.storage,
    });

    if (
      result &&
      opts.req.payload &&
      result.acceptedValues &&
      Object.keys(result.acceptedValues).length > 0
    ) {
      // TODO handle partial updates
      this.mutationSubscriptions.forEach((handler) => {
        handler({
          _id: opts.req.messageId ?? nanoid(),
          type: "MUTATE",
          resource: opts.req.resourceName,
          mutationType:
            opts.req.type.toLowerCase() as MutationMessage["mutationType"],
          payload: result.acceptedValues ?? {},
          resourceId:
            opts.req.resourceId ??
            (result.data.value as unknown as { id: { value: string } }).id
              .value,
        });
      });
    }

    return result;
  }
}

export const server = Server.create;

////////////////////////////// TESTING
