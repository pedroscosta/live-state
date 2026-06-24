import { consumeGeneratable } from "../../core/utils";
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

export const createClient = <TRouter extends ClientRouterConstraint>(
  opts: FetchClientOptions,
): Client<TRouter, true> => {
  return {
    query: new Proxy({} as Client<TRouter, true>["query"], {
      get(_, prop) {
        if (typeof prop !== "string") return undefined;
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
