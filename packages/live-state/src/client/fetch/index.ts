import { stringify } from "qs";
import { QueryBuilder, type QueryExecutor } from "../../core/query";
import { consumeGeneratable } from "../../core/utils";
import {
  inferValue,
  type LiveObjectAny,
  type LiveObjectMutationInput,
} from "../../schema";
import type { ClientOptions } from "..";
import type { Client, ClientRouterConstraint } from "../types";
import { createObservable } from "../utils";

export type FetchClientOptions = Omit<ClientOptions, "storage"> & {
  fetchOptions?: RequestInit;
};

const safeFetch = async (
  url: string,
  options?: RequestInit,
  baseOptions?: RequestInit
) => {
  const normalizeHeaders = (
    headers: HeadersInit | undefined
  ): Record<string, string> => {
    if (!headers) return {};
    if (headers instanceof Headers) {
      const result: Record<string, string> = {};
      headers.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers);
    }
    return headers as Record<string, string>;
  };

  const baseHeaders = normalizeHeaders(baseOptions?.headers);
  const optionsHeaders = normalizeHeaders(options?.headers);

  const mergedOptions: RequestInit = {
    ...baseOptions,
    ...options,
    headers: {
      ...baseHeaders,
      ...optionsHeaders,
    },
  };

  const res = await fetch(url, mergedOptions);

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = await res.text().catch(() => undefined);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`, {
      cause: data,
    });
  }
  return data;
};

const serializeNullValues = (value: any): any => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return value.map(serializeNullValues);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    value.constructor === Object
  ) {
    const serialized: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      serialized[key] = serializeNullValues(val);
    }
    return serialized;
  }

  return value;
};

export const createClient = <TRouter extends ClientRouterConstraint>(
  opts: FetchClientOptions
): Client<TRouter, true> => {
  const queryExecutor: QueryExecutor = {
    get: async (query) => {
      const serializedQuery = serializeNullValues(query);
      const qs = stringify(serializedQuery);
      const headers = (await consumeGeneratable(opts.credentials)) ?? {};

      const res = await safeFetch(
        `${opts.url}/${query.resource}${qs ? `?${qs}` : ""}`,
        {
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
        },
        opts.fetchOptions
      );

      if (!res || typeof res !== "object") {
        return [];
      }

      if (Array.isArray(res)) {
        return res.map((item: any) => {
          const inferred = inferValue(item);
          const id = item?.value?.id?.value ?? item?.id;
          return {
            ...inferred,
            id,
          };
        }) as any[];
      }

      // TODO remove this
      // Handle object response (legacy format)
      return Object.entries(res).map(([key, value]) => ({
        ...inferValue(value as any),
        id: key,
      })) as any[];
    },
    subscribe: () => {
      throw new Error("Fetch client does not support subscriptions");
    },
  };

  const wrapQueryBuilderWithCustomQueries = (
    routeName: string,
    queryBuilder: QueryBuilder<any, any, any, any>
  ) => {
    return new Proxy(queryBuilder, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        // If it's a string, it's a custom query method
        if (typeof prop === "string") {
          return async (input?: any) => {
            const headers = (await consumeGeneratable(opts.credentials)) ?? {};
            return await safeFetch(
              `${opts.url}/${routeName}/query/${prop}`,
              {
                method: "POST",
                headers: {
                  ...headers,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ input }),
              },
              opts.fetchOptions
            );
          };
        }
        return undefined;
      },
    });
  };

  return {
    query: Object.entries(opts.schema).reduce(
      (acc, [key, value]) => {
        acc[key as keyof TRouter["routes"]] = wrapQueryBuilderWithCustomQueries(
          key,
          QueryBuilder._init(value, queryExecutor, true)
        );
        return acc;
      },
      {} as any
    ) as Client<TRouter, true>["query"],
    mutate: createObservable(() => {}, {
      apply: async (_, path, argumentsList) => {
        if (path.length < 2) return;
        if (path.length > 2)
          throw new Error("Trying to access an invalid path");

        const [route, method] = path;

        const headers = (await consumeGeneratable(opts.credentials)) ?? {};

        if (method === "insert") {
          const { id, ...input } = argumentsList[0];
          await safeFetch(
            `${opts.url}/${route}/insert`,
            {
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
            },
            opts.fetchOptions
          );
          return;
        }

        if (method === "update") {
          const [id, input] = argumentsList;

          const { id: _id, ...rest } = input;
          await safeFetch(
            `${opts.url}/${route}/update`,
            {
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
            },
            opts.fetchOptions
          );
          return;
        }

        return await safeFetch(
          `${opts.url}/${route}/${method}`,
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ payload: argumentsList[0] }),
          },
          opts.fetchOptions
        );
      },
    }) as unknown as Client<TRouter, true>["mutate"],
  };
};
