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
        hello: mutation(z.string()).handler(async ({ req }) => {
          return {
            message: `Hello ${req.input}`,
          };
        }),
        customFind: mutation().handler(async ({ req, db }) => {
          return db.find("cards", undefined, {
            group: true,
          });
        }),
        customFindOne: mutation(z.string()).handler(async ({ req, db }) => {
          return db.findById("cards", req.input!, {
            group: true,
          });
        }),
      })),
    cards: publicRoute.createBasicRoute(schema.cards),
  },
});

export type Router = typeof routerImpl;
