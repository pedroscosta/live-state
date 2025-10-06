import type { z } from "zod";
import type { ConditionalPromise, Promisify } from "../core/utils";
import type { InferInsert, InferUpdate } from "../schema";
import type { AnyRouter } from "../server";
import type { Simplify } from "../utils";
import type { QueryBuilder } from "./query";

export type Client<
  TRouter extends AnyRouter,
  TShouldAwait extends boolean = false,
> = {
  query: {
    [K in keyof TRouter["routes"]]: QueryBuilder<
      TRouter["routes"][K]["_resourceSchema"],
      {},
      false,
      TShouldAwait
    >;
  };
  mutate: {
    [K in keyof TRouter["routes"]]: {
      insert: (
        input: Simplify<InferInsert<TRouter["routes"][K]["_resourceSchema"]>>
      ) => ConditionalPromise<void, TShouldAwait>;
      update: (
        id: string,
        value: Simplify<InferUpdate<TRouter["routes"][K]["_resourceSchema"]>>
      ) => ConditionalPromise<void, TShouldAwait>;
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
