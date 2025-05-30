import type { ClientOptions, ClientState } from ".";
import {
  inferValue,
  LiveObjectAny,
  type LiveObjectMutationInput,
  type LiveTypeAny,
  type MaterializedLiveType,
} from "../schema";
import type { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { createObservable } from "./observable";

type Getters<T> = {
  [K in keyof T]: { get: () => Promise<Simplify<T[K]>> };
};

type FetchClient<TRouter extends AnyRouter> = Getters<ClientState<TRouter>> & {
  [K in keyof TRouter["routes"]]: {
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

      if (method === "get")
        return fetch(`${opts.url}/${resource}`).then(async (res) =>
          Object.fromEntries(
            Object.entries((await res.json()) ?? {}).map(([k, v]) => [
              k,
              inferValue(v as MaterializedLiveType<LiveTypeAny>),
            ])
          )
        );

      if (method === "upsert") {
        const { id, ...rest } = argumentsList[0];
        return fetch(`${opts.url}/${resource}/set`, {
          method: "POST",
          headers: {
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
          "Content-Type": "application/json",
        },
        body: JSON.stringify(argumentsList[0]),
      });
    },
  }) as unknown as FetchClient<TRouter>;
};
