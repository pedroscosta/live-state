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
  baseOptions?: RequestInit,
) => {
  const normalizeHeaders = (
    headers: HeadersInit | undefined,
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

const isUnknownProcedureError = (error: unknown): boolean => {
  // TODO: Remove this helper when default mutation fallback is removed.
  if (error instanceof Error && error.message.includes("Unknown procedure")) {
    return true;
  }

  if (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    ("message" in error.cause || "code" in error.cause)
  ) {
    const cause = error.cause as { message?: unknown; code?: unknown };
    const causeMessage = cause.message;
    const hasUnknownProcedureCode =
      cause.code === "UNKNOWN_PROCEDURE" ||
      cause.code === "unknown_procedure";
    const hasUnknownProcedureMessage =
      typeof causeMessage === "string" &&
      causeMessage.includes("Unknown procedure");
    return hasUnknownProcedureCode || hasUnknownProcedureMessage;
  }

  return false;
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
  opts: FetchClientOptions,
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
        opts.fetchOptions,
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
    queryBuilder: QueryBuilder<any, any, any, any>,
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
              opts.fetchOptions,
            );
          };
        }
        return undefined;
      },
    });
  };

  return {
    query: new Proxy({} as Client<TRouter, true>["query"], {
      get(_, prop) {
        if (typeof prop !== "string") return undefined;
        if (Object.hasOwn(opts.schema, prop)) {
          return wrapQueryBuilderWithCustomQueries(
            prop,
            QueryBuilder._init(opts.schema[prop], queryExecutor, true),
          );
        }
        return new Proxy(
          {},
          {
            get(_, queryProp) {
              if (typeof queryProp !== "string") return undefined;
              return async (input?: any) => {
                const headers =
                  (await consumeGeneratable(opts.credentials)) ?? {};
                return await safeFetch(
                  `${opts.url}/${prop as string}/query/${queryProp as string}`,
                  {
                    method: "POST",
                    headers: {
                      ...headers,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ input }),
                  },
                  opts.fetchOptions,
                );
              };
            },
          },
        );
      },
      has(_, prop) {
        return typeof prop === "string";
      },
    }),
    mutate: createObservable(() => {}, {
      apply: async (_, path, argumentsList) => {
        if (path.length < 2) return;
        if (path.length > 2)
          throw new Error("Trying to access an invalid path");

        const [route, method] = path;

        const headers = (await consumeGeneratable(opts.credentials)) ?? {};

        if (method === "insert") {
          // TODO: Remove generic-first + legacy fallback path when default mutations are removed.
          try {
            return await safeFetch(
              `${opts.url}/${route}/${method}`,
              {
                method: "POST",
                headers: {
                  ...headers,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  payload: argumentsList[0],
                  meta: { timestamp: new Date().toISOString() },
                }),
              },
              opts.fetchOptions,
            );
          } catch (error) {
            if (!isUnknownProcedureError(error)) {
              throw error;
            }
          }

          const { id, ...input } = argumentsList[0] ?? {};
          return await safeFetch(
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
                  new Date().toISOString(),
                ),
              }),
            },
            opts.fetchOptions,
          );
        }

        if (method === "update") {
          // TODO: Remove generic-first + legacy fallback path when default mutations are removed.
          const customPayload =
            argumentsList.length > 1 &&
            typeof argumentsList[0] === "string" &&
            typeof argumentsList[1] === "object" &&
            argumentsList[1] !== null
              ? { id: argumentsList[0], ...argumentsList[1] }
              : argumentsList[0];

          try {
            return await safeFetch(
              `${opts.url}/${route}/${method}`,
              {
                method: "POST",
                headers: {
                  ...headers,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  payload: customPayload,
                  meta: { timestamp: new Date().toISOString() },
                }),
              },
              opts.fetchOptions,
            );
          } catch (error) {
            if (!isUnknownProcedureError(error)) {
              throw error;
            }
          }

          const [id, input] =
            argumentsList.length > 1
              ? argumentsList
              : [argumentsList[0]?.id, argumentsList[0]];
          const { id: _id, ...rest } = input ?? {};
          return await safeFetch(
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
                  new Date().toISOString(),
                ),
              }),
            },
            opts.fetchOptions,
          );
        }

        return await safeFetch(
          `${opts.url}/${route}/${method}`,
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload: argumentsList[0],
              meta: { timestamp: new Date().toISOString() },
            }),
          },
          opts.fetchOptions,
        );
      },
    }) as unknown as Client<TRouter, true>["mutate"],
  };
};
