import { z } from "zod";
import { Promisify } from "../core/utils";
import type {
  InferIndex,
  InferLiveObject,
  LiveObjectMutationInput,
} from "../schema";
import type { AnyRouter } from "../server";
import { Simplify } from "../utils";

export type DeepSubscribable<T> = {
  [K in keyof T]: DeepSubscribable<T[K]>;
} & {
  get: () => T;
  subscribe: (callback: (value: T) => void) => () => void;
};

export type Client<TRouter extends AnyRouter> = DeepSubscribable<{
  [K in keyof TRouter["routes"]]:
    | Record<
        InferIndex<TRouter["routes"][K]["_resourceSchema"]>,
        InferLiveObject<TRouter["routes"][K]["_resourceSchema"]>
      >
    | undefined;
}> & {
  [K in keyof TRouter["routes"]]: {
    // TODO handle these as custom mutations
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
