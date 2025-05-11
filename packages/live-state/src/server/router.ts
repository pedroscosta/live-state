import {
  FindRequest,
  Middleware,
  NextFunction,
  Request,
  SetRequest,
  Storage,
} from ".";
import { LiveObjectAny, MaterializedLiveType, Schema } from "../schema";

export type RouteRecord = Record<string, AnyRoute>;

export class Router<TRoutes extends RouteRecord> {
  readonly routes: TRoutes;

  private constructor(opts: { routes: TRoutes }) {
    this.routes = opts.routes;
  }

  public static create<TRoutes extends RouteRecord>(opts: { routes: TRoutes }) {
    return new Router<TRoutes>(opts);
  }
}

export const router = <
  TSchema extends Schema<any>,
  TRoutes extends Record<keyof TSchema, AnyRoute>, // TODO Make this partial
>(opts: {
  schema: TSchema;
  routes: TRoutes;
}) => Router.create<TRoutes>({ ...opts });

export type AnyRouter = Router<RouteRecord>;

export type RouteResult<TShape extends LiveObjectAny> = {
  data:
    | MaterializedLiveType<TShape>
    | Record<string, MaterializedLiveType<TShape>>;
  acceptedValues: Record<string, any> | null;
};

export class Route<
  TShape extends LiveObjectAny,
  TMiddleware extends Middleware<RouteResult<TShape>>,
> {
  readonly shape: TShape;
  readonly middlewares: Set<TMiddleware>;

  public constructor(shape: TShape) {
    this.shape = shape;
    this.middlewares = new Set();
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
    const next = (req: Request) => {
      switch (opts.req.type) {
        case "FIND":
          return this.handleFind({
            req: req as FindRequest,
            db: opts.db,
          });
        case "SET":
          return this.handleSet({
            req: req as SetRequest,
            db: opts.db,
          });
        default:
          throw new Error("Invalid request type");
      }
    };

    return await Array.from(this.middlewares.values()).reduceRight(
      (next, middleware) => {
        return (req) => middleware({ req, next });
      },
      (async (req) => next(req)) as NextFunction<RouteResult<TShape>>
    )(opts.req);
  }

  public use(middleware: TMiddleware) {
    this.middlewares.add(middleware);
    return this;
  }
}

export const routeFactory = () => {
  return <T extends LiveObjectAny>(shape: T) =>
    new Route<T, Middleware<RouteResult<T>>>(shape);
};

export type AnyRoute = Route<LiveObjectAny, Middleware<any>>;
