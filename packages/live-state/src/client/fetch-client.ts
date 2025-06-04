import { stringify } from "qs";
import type { ClientOptions } from ".";
import { consumeGeneratable } from "../core/utils";
import {
  InferLiveObject,
  inferValue,
  LiveObjectAny,
  WhereClause,
  type LiveObjectMutationInput,
  type LiveTypeAny,
  type MaterializedLiveType,
} from "../schema";
import type { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { createObservable } from "./observable";

type GetOptions<T extends LiveObjectAny> = {
  headers?: Record<string, string>;
  where?: WhereClause<T>;
};

type FetchClient<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]: {
    get: (
      opts?: GetOptions<TRouter["routes"][K]["_resourceSchema"]>
    ) => Promise<
      Simplify<InferLiveObject<TRouter["routes"][K]["_resourceSchema"]>>
    >;
    upsert: (
      input: Simplify<
        LiveObjectMutationInput<TRouter["routes"][K]["_resourceSchema"]>
      >
    ) => Promise<void>;
  };
};

export const createClient = <TRouter extends AnyRouter>(
  opts: ClientOptions
): FetchClient<TRouter> => {
  return createObservable(() => {}, {
    apply: (_, path, argumentsList) => {
      if (path.length > 2) throw new Error("Trying to access invalid property");

      const [resource, method] = path;

      const headers = consumeGeneratable(opts.credentials);

      if (method === "get") {
        const where = argumentsList[0] as
          | GetOptions<TRouter["routes"][string]["_resourceSchema"]>
          | undefined;

        const query: Record<string, any> = {};

        if (where?.where) {
          query.where = where.where;
        }

        return fetch(
          `${opts.url}/${resource}${Object.keys(query).length > 0 ? `?${stringify(query)}` : ""}`,
          {
            headers,
          }
        ).then(async (res) =>
          Object.fromEntries(
            Object.entries((await res.json()) ?? {}).map(([k, v]) => [
              k,
              inferValue(v as MaterializedLiveType<LiveTypeAny>),
            ])
          )
        );
      }

      if (method === "upsert") {
        const { id, ...rest } = argumentsList[0];
        return fetch(`${opts.url}/${resource}/set`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resourceId: id,
            payload: opts.schema[resource].encodeMutation(
              "set",
              rest as LiveObjectMutationInput<LiveObjectAny>,
              new Date().toISOString()
            ),
          }),
        });
      }

      return fetch(`${opts.url}/${resource}/${method}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(argumentsList[0]),
      });
    },
  }) as unknown as FetchClient<TRouter>;
};
