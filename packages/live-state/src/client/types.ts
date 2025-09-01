import { z } from "zod";
import { Promisify } from "../core/utils";
import type { LiveObjectMutationInput } from "../schema";
import type { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { QueryBuilder } from "./query";

export type Client<TRouter extends AnyRouter> = {
  query: {
    [K in keyof TRouter["routes"]]: QueryBuilder<
      TRouter["routes"][K]["_resourceSchema"]
    >;
  };
  mutate: {};
};

//// TO BE REMOVED

export type DeepSubscribable<T> = {
  [K in keyof T]: DeepSubscribable<T[K]>;
} & {
  get: () => T;
  subscribe: (callback: (value: T) => void) => () => void;
};

export type _Client<TRouter extends AnyRouter> = {
  [K in keyof TRouter["routes"]]: {
    insert: (
      input: Simplify<
        LiveObjectMutationInput<TRouter["routes"][K]["_resourceSchema"]>
      >
    ) => void;
    update: (
      id: string,
      value: Omit<
        Simplify<
          LiveObjectMutationInput<TRouter["routes"][K]["_resourceSchema"]>
        >,
        "id"
      >
    ) => void;
  };
} & {
  [K in keyof TRouter["routes"]]: {
    [K2 in keyof TRouter["routes"][K]["customMutations"]]: (
      input: z.infer<
        TRouter["routes"][K]["customMutations"][K2]["inputValidator"]
      >
    ) => Promisify<
      ReturnType<TRouter["routes"][K]["customMutations"][K2]["handler"]>
    >;
  };
};
