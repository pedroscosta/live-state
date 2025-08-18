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
        customFind: mutation(z.string().optional()).handler(
          async ({ req, db }) => {
            return db.find(schema.groups, {
              where: {
                ...(req.input ? { id: req.input } : {}),
              },
              include: {
                cards: true,
              },
            });
          }
        ),
        customFindOne: mutation(z.string()).handler(async ({ req, db }) => {
          const result = await db.findOne(schema.cards, req.input!, {
            include: {
              group: true,
            },
          });

          return result;
        }),
      })),
    cards: publicRoute.createBasicRoute(schema.cards),
  },
});

export type Router = typeof routerImpl;
