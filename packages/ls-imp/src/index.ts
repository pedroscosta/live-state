import { number, object } from "@repo/live-state";
import { routeFactory, router } from "@repo/live-state/server";

export const counters = object({
  id: number(),
  counter: number(),
});

const publicRoute = routeFactory();

export const routerImpl = router({
  routes: {
    counters: publicRoute(counters),
  },
});

export type Router = typeof routerImpl;

export const schema = {
  counters,
};
