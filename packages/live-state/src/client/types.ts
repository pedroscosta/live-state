import type { z } from "zod";
import type { Promisify } from "../core/utils";
import type { InferInsert, InferUpdate } from "../schema";
import type { AnyRouter } from "../server";
import type { Simplify } from "../utils";
import type { QueryBuilder } from "./query";

export type Client<TRouter extends AnyRouter> = {
  query: {
    [K in keyof TRouter["routes"]]: QueryBuilder<
      TRouter["routes"][K]["_resourceSchema"]
    >;
  };
  mutate: {
    [K in keyof TRouter["routes"]]: {
      insert: (
        input: Simplify<InferInsert<TRouter["routes"][K]["_resourceSchema"]>>
      ) => void;
      update: (
        id: string,
        value: Simplify<InferUpdate<TRouter["routes"][K]["_resourceSchema"]>>
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
