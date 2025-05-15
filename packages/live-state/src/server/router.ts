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

export type QueryResult<TShape extends LiveObjectAny> = {
  data: Record<string, MaterializedLiveType<TShape>>;
};

export type MutationResult<TShape extends LiveObjectAny> = {
  data: MaterializedLiveType<TShape>;
  acceptedValues: Record<string, any> | null;
};

export type RequestHandler<
  TResourceSchema extends LiveObjectAny,
  TResult,
  TSchema extends Schema<any> = Schema<any>,
> = (opts: { req: Request; db: Storage; schema: TSchema }) => Promise<TResult>;

export class Route<
  TResourceSchema extends LiveObjectAny,
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<string, RequestHandler<TResourceSchema, any>>,
> {
  readonly _resourceSchema!: TResourceSchema;
  readonly resourceName: TResourceSchema["name"];
  readonly middlewares: Set<TMiddleware>;
  readonly customMutations: TCustomMutations;

  public constructor(
    resourceName: TResourceSchema["name"],
    customMutations?: TCustomMutations
  ) {
    this.resourceName = resourceName;
    this.middlewares = new Set();
    this.customMutations = customMutations ?? ({} as TCustomMutations);
  }

  private handleFind: RequestHandler<
    TResourceSchema,
    QueryResult<TResourceSchema>
  > = async ({ req, db }) => {
    return {
      data: await db.find<TResourceSchema>(req.resourceName, req.where),
      acceptedValues: null,
    };
  };

  private handleSet: RequestHandler<
    TResourceSchema,
    MutationResult<TResourceSchema>
  > = async ({ req: _req, db, schema }) => {
    const req = _req as SetRequest;
    if (!req.payload) throw new Error("Payload is required");
    if (!req.resourceId) throw new Error("ResourceId is required");

    const target = await db.findById<TResourceSchema>(
      req.resourceName,
      req.resourceId
    );

    // TODO Handle where clause in the stored data, in the payload and in the final result

    const [newRecord, acceptedValues] = schema[this.resourceName].mergeMutation(
      "set",
      req.payload,
      target
    );

    if (!acceptedValues) {
      throw new Error("Mutation rejected");
    }

    return {
      data: await db.upsert<TResourceSchema>(
        req.resourceName,
        req.resourceId,
        newRecord
      ),
      acceptedValues,
    };
  };

  public async handleRequest(opts: {
    req: Request;
    db: Storage;
    schema: Schema<any>;
  }): Promise<any> {
    const next = (req: Request) =>
      (() => {
        if (req.type === "QUERY") {
          return this.handleFind({
            req: req as FindRequest,
            db: opts.db,
            schema: opts.schema,
          });
        } else if (req.type === "MUTATE") {
          if (!req.procedure) {
            return this.handleSet({
              req: req as SetRequest,
              db: opts.db,
              schema: opts.schema,
            });
          } else if (this.customMutations[req.procedure]) {
            return this.customMutations[req.procedure]({
              req: req as SetRequest,
              db: opts.db,
              schema: opts.schema,
            });
          }
        }

        throw new Error("Invalid request");
      })();

    return await Array.from(this.middlewares.values()).reduceRight(
      (next, middleware) => {
        return (req) => middleware({ req, next });
      },
      (async (req) => next(req)) as NextFunction<any>
    )(opts.req);
  }

  public use(middleware: TMiddleware) {
    this.middlewares.add(middleware);
    return this;
  }

  public withMutations(
    mutations: Record<string, RequestHandler<TResourceSchema, any>>
  ) {
    return new Route<TResourceSchema, TMiddleware, typeof mutations>(
      this.resourceName,
      mutations
    );
  }
}

export const routeFactory = () => {
  return <T extends LiveObjectAny>(shape: T) =>
    new Route<T, Middleware<any>, Record<string, never>>(shape.name);
};

export type AnyRoute = Route<
  LiveObjectAny,
  Middleware<any>,
  Record<string, any>
>;
