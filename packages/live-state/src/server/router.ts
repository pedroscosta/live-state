import { z, ZodTypeAny } from "zod";
import { Middleware, NextFunction, ParsedRequest, Storage } from ".";
import {
  LiveObjectAny,
  LiveObjectMutationInput,
  LiveTypeAny,
  MaterializedLiveType,
  Schema,
} from "../schema";

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
  TInput,
  TResult,
  TSchema extends Schema<any> = Schema<any>,
> = (opts: {
  req: ParsedRequest<TInput>;
  db: Storage;
  schema: TSchema;
}) => Promise<TResult>;

export type Mutation<
  TInputValidator extends ZodTypeAny, // TODO use StandardSchema instead
  THandler extends RequestHandler<z.infer<TInputValidator>, any, any>,
> = {
  inputValidator: TInputValidator;
  handler: THandler;
};

const mutationCreator = <TInputValidator extends ZodTypeAny>(
  validator?: TInputValidator
) => {
  return {
    handler: <
      THandler extends RequestHandler<z.infer<TInputValidator>, any, any>,
    >(
      handler: THandler
    ) =>
      ({
        inputValidator: validator ?? z.undefined(),
        handler,
      }) as Mutation<TInputValidator, THandler>,
  };
};

export class Route<
  TResourceSchema extends LiveObjectAny,
  TMiddleware extends Middleware<any>,
  TCustomMutations extends Record<
    string,
    Mutation<any, RequestHandler<any, any>>
  >,
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

  // TODO handle this as a custom mutation
  private handleFind: RequestHandler<never, QueryResult<TResourceSchema>> =
    async ({ req, db }) => {
      return {
        data: await db.find<TResourceSchema>(req.resourceName, req.where),
        acceptedValues: null,
      };
    };

  // TODO handle this as a custom mutation
  private handleSet: RequestHandler<
    LiveObjectMutationInput<TResourceSchema>,
    MutationResult<TResourceSchema>
  > = async ({ req, db, schema }) => {
    if (!req.input) throw new Error("Payload is required");
    if (!req.resourceId) throw new Error("ResourceId is required");

    const target = await db.findById<TResourceSchema>(
      req.resourceName,
      req.resourceId
    );

    // TODO Handle where clause in the stored data, in the payload and in the final result

    const [newRecord, acceptedValues] = schema[this.resourceName].mergeMutation(
      "set",
      req.input as Record<string, MaterializedLiveType<LiveTypeAny>>,
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
    req: ParsedRequest;
    db: Storage;
    schema: Schema<any>;
  }): Promise<any> {
    const next = (req: ParsedRequest) =>
      (() => {
        if (req.type === "QUERY") {
          return this.handleFind({
            req: req as ParsedRequest<never>,
            db: opts.db,
            schema: opts.schema,
          });
        } else if (req.type === "MUTATE") {
          if (!req.procedure) {
            return this.handleSet({
              req: req as ParsedRequest<
                LiveObjectMutationInput<TResourceSchema>
              >,
              db: opts.db,
              schema: opts.schema,
            });
          } else if (this.customMutations[req.procedure]) {
            const validInput = this.customMutations[
              req.procedure
            ].inputValidator.parse(req.input);

            req.input = validInput;

            return this.customMutations[req.procedure].handler({
              req,
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

  public withMutations<
    T extends Record<string, Mutation<any, RequestHandler<any, any>>>,
  >(mutationFactory: (opts: { mutation: typeof mutationCreator }) => T) {
    return new Route<TResourceSchema, TMiddleware, T>(
      this.resourceName,
      mutationFactory({ mutation: mutationCreator })
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
