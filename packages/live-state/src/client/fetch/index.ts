import { stringify } from "qs";
import { consumeGeneratable } from "../../core/utils";
import {
  type IncludeClause,
  type InferInsert,
  type InferLiveObject,
  type InferUpdate,
  inferValue,
  type LiveObjectAny,
  type LiveObjectMutationInput,
  type LiveTypeAny,
  type MaterializedLiveType,
  type WhereClause,
} from "../../schema";
import type { AnyRouter } from "../../server";
import type { Simplify } from "../../utils";
import type { ClientOptions } from "..";
import { createObservable } from "../utils";

type GetOptions<T extends LiveObjectAny> = {
  headers?: Record<string, string>;
  where?: WhereClause<T>;
  include?: IncludeClause<T>;
};

type FetchClient<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]: {
    get: (
      opts?: GetOptions<TRouter["routes"][K]["_resourceSchema"]>
    ) => Promise<
      Record<
        string,
        Simplify<InferLiveObject<TRouter["routes"][K]["_resourceSchema"]>>
      >
    >;
    insert: (
      input: Simplify<InferInsert<TRouter["routes"][K]["_resourceSchema"]>>
    ) => Promise<void>;
    update: (
      id: string,
      input: Simplify<InferUpdate<TRouter["routes"][K]["_resourceSchema"]>>
    ) => Promise<void>;
  };
};

export const createClient = <TRouter extends AnyRouter>(
  opts: Omit<ClientOptions, "storage">
): FetchClient<TRouter> => {
  return createObservable(() => {}, {
    apply: async (_, path, argumentsList) => {
      if (path.length > 2) throw new Error("Trying to access invalid property");

      const [resource, method] = path;

      const headers = (await consumeGeneratable(opts.credentials)) ?? {};

      if (method === "get") {
        const where = argumentsList[0] as
          | GetOptions<TRouter["routes"][string]["_resourceSchema"]>
          | undefined;

        const query: Record<string, any> = {};

        if (where?.where) {
          query.where = where.where;
        }

        if (where?.include) {
          query.include = where.include;
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

      if (method === "insert") {
        const { id, ...rest } = argumentsList[0];
        return fetch(`${opts.url}/${resource}/insert`, {
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

      if (method === "update") {
        const id = argumentsList[0];
        const { id: _id, ...rest } = argumentsList[1];
        return fetch(`${opts.url}/${resource}/update`, {
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
