import { routeFactory, router } from "@live-state/sync/server";
import { z } from "zod";

import { schema } from "./schema";

/*
 * Routes
 */

const publicRoute = routeFactory();

export const routerImpl = router({
  schema,
  routes: {
    groups: publicRoute
      .createBasicRoute(schema.groups)
      .withMutations(({ mutation }) => ({
        customMutatorTest: mutation(z.string()).handler(async ({ req }) => {
          return {
            message: `Hello ${req.input}`,
          };
        }),
      })),
    cards: publicRoute.createBasicRoute(schema.cards),
  },
});

export type Router = typeof routerImpl;
