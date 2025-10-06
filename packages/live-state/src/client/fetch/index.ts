import { stringify } from "qs";
import { consumeGeneratable } from "../../core/utils";
import type { LiveObjectAny, LiveObjectMutationInput } from "../../schema";
import type { AnyRouter } from "../../server";
import type { ClientOptions } from "..";
import { QueryBuilder, type QueryExecutor } from "../query";
import type { Client } from "../types";
import { createObservable } from "../utils";

export const createClient = <TRouter extends AnyRouter>(
  opts: Omit<ClientOptions, "storage">
): Client<TRouter, true> => {
  const queryExecutor: QueryExecutor = {
    get: async (query) => {
      const qs = stringify(query);
      const headers = (await consumeGeneratable(opts.credentials)) ?? {};

      const res = await fetch(
        `${opts.url}/${query.resource}${qs ? `?${qs}` : ""}`,
        {
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
        }
      ).then((res) => res.json());

      return res as any[];
    },
    subscribe: () => {
      throw new Error("Fetch client does not support subscriptions");
    },
  };

  return {
    query: Object.entries(opts.schema).reduce(
      (acc, [key, value]) => {
        acc[key as keyof TRouter["routes"]] = QueryBuilder._init(
          value,
          queryExecutor,
          true
        );
        return acc;
      },
      {} as Record<
        keyof TRouter["routes"],
        QueryBuilder<
          TRouter["routes"][keyof TRouter["routes"]]["_resourceSchema"],
          {},
          false,
          true
        >
      >
    ),
    mutate: createObservable(() => {}, {
      apply: async (_, path, argumentsList) => {
        if (path.length < 2) return;
        if (path.length > 2)
          throw new Error("Trying to access an invalid path");

        const [route, method] = path;

        const headers = (await consumeGeneratable(opts.credentials)) ?? {};

        if (method === "insert") {
          const { id, ...input } = argumentsList[0];
          return fetch(`${opts.url}/${route}/insert`, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resourceId: id,
              payload: opts.schema[route].encodeMutation(
                "set",
                input as LiveObjectMutationInput<LiveObjectAny>,
                new Date().toISOString()
              ),
            }),
          }).then((res) => res.json());
        }

        if (method === "update") {
          const [id, input] = argumentsList;

          const { id: _id, ...rest } = input;
          return fetch(`${opts.url}/${route}/update`, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resourceId: id,
              payload: opts.schema[route].encodeMutation(
                "set",
                rest as LiveObjectMutationInput<LiveObjectAny>,
                new Date().toISOString()
              ),
            }),
          }).then((res) => res.json());
        }

        return fetch(`${opts.url}/${route}/${method}`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ payload: argumentsList[0] }),
        }).then((res) => res.json());
      },
    }) as unknown as Client<TRouter>["mutate"],
  };
};
