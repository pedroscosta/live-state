import { nanoid } from "nanoid";
import { MutationMessage } from "../core/internals";
import { Schema } from "../schema";
import { AnyRouter } from "./router";
import { Storage } from "./storage";

export * from "./router";
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
