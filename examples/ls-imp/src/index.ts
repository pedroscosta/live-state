import { routeFactory, router } from "@live-state/sync/server";

import { schema } from "./schema";

/*
 * Routes
 */

const publicRoute = routeFactory();

export const routerImpl = router({
  schema,
  routes: {
    groups: publicRoute(schema.groups),
    cards: publicRoute(schema.cards),
  },
});

export type Router = typeof routerImpl;

export { schema };
