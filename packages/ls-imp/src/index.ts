import { number } from "@repo/live-state";
import { createRouter, route, update } from "@repo/live-state/server";

export const counter = number();

export const router = createRouter({
  counter: route(counter).withMutations({
    set: update(),
  }),
});

export type Router = typeof router;
