import type { AnyRouter } from "../server";
import { QueryBuilder } from "./query";

export type Client<TRouter extends AnyRouter> = {
  query: {
    [K in keyof TRouter["routes"]]: QueryBuilder<
      TRouter["routes"][K]["_resourceSchema"]
    >;
  };
  mutate: {};
};
