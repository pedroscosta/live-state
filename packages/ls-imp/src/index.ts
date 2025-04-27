import { number, object, string } from "@repo/live-state";
import { routeFactory, router } from "@repo/live-state/server";

export const counters = object("counters", {
  id: string(),
  counter: number(),
});

const publicRoute = routeFactory();

export const schema = {
  entities: [counters],
};

export const routerImpl = router({
  routes: {
    counters: publicRoute(counters),
  },
});

export type Router = typeof routerImpl;
