import { nanoid } from "nanoid";
import { MutationMessage } from "../core/internals";
import { LiveObjectAny, MaterializedLiveType, Schema } from "../schema";
import { Storage } from "./storage";

export * from "./storage";
export * from "./web-socket";

type RequestBase = {
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
    req: FindRequest;
    db: Storage;
  }): Promise<RouteResult<TShape>> {
    return {
      data: await opts.db.find<TShape>(opts.req.resourceName, opts.req.where),
      acceptedValues: null,
    };
  }

  private async handleSet(opts: {
    req: SetRequest;
    db: Storage;
  }): Promise<RouteResult<TShape>> {
    if (!opts.req.payload) throw new Error("Payload is required");
    if (!opts.req.resourceId) throw new Error("ResourceId is required");

    const target = await opts.db.findById<TShape>(
      opts.req.resourceName,
      opts.req.resourceId
    );

    // Handle where clause in the stored data, in the payload and in the final result

    const [newRecord, acceptedValues] = this.shape.mergeMutation(
      "set",
      opts.req.payload,
      target
    );

    if (!acceptedValues) {
      if (!target) throw new Error("Mutation rejected");
      return {
        data: target,
        acceptedValues: null,
      };
    }

    return {
      data: await opts.db.upsert<TShape>(
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
        return this.handleFind(opts as { req: FindRequest; db: Storage });
      case "SET":
        return this.handleSet(opts as { req: SetRequest; db: Storage });
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
      opts.req.type === "SET" &&
      result.acceptedValues &&
      Object.keys(result.acceptedValues).length > 0
    ) {
      // TODO handle partial updates
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
}

export const server = Server.create;

////////////////////////////// TESTING
