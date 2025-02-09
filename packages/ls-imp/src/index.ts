import { number } from "@repo/live-state";
import { createRouter, route, update } from "@repo/live-state/server";

export const counter = number();

export const router = createRouter({
  counter: route(counter).withMutations({
    set: update(),
  }),
});

export type Router = typeof router;

const test = router.routes.counter.mutations.set.mutate({
  value: 10,
  _metadata: { timestamp: new Date().toISOString() },
});
