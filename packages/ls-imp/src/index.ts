import { number, object, string } from "@repo/live-state";
import { routeFactory, router } from "@repo/live-state/server";

export const counters = object({
  id: string(),
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
