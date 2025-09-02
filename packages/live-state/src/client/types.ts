import { z } from "zod";
import { Promisify } from "../core/utils";
import { LiveObjectMutationInput } from "../schema";
import type { AnyRouter } from "../server";
import { Simplify } from "../utils";
import { QueryBuilder } from "./query";

export type Client<TRouter extends AnyRouter> = {
  query: {
    [K in keyof TRouter["routes"]]: QueryBuilder<
      TRouter["routes"][K]["_resourceSchema"]
    >;
  };
  mutate: {
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
    } & {
      [K2 in keyof TRouter["routes"][K]["customMutations"]]: (
        input: z.infer<
          TRouter["routes"][K]["customMutations"][K2]["inputValidator"]
        >
      ) => Promisify<
        ReturnType<TRouter["routes"][K]["customMutations"][K2]["handler"]>
      >;
    };
  };
};
