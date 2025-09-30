import { routeFactory, router } from "@live-state/sync/server";
import { z } from "zod";

import { generateId } from "../../../packages/live-state/src/core/utils";
import { schema } from "./schema";

/*
 * Routes
 */

const publicRoute = routeFactory();

export const routerImpl = router({
  schema,
  routes: {
    groups: publicRoute
      .collectionRoute(schema.groups)
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
        customInsert: mutation(z.string()).handler(async ({ req, db }) => {
          return db.insert(schema.groups, {
            id: generateId(),
            name: req.input!,
          });
        }),
        customUpdate: mutation(z.string()).handler(async ({ req, db }) => {
          return db.update(schema.groups, req.input!, {
            name: "Updated",
          });
        }),
        transaction: mutation().handler(async ({ req, db }) => {
          return db.transaction(async ({ trx, commit, rollback }) => {
            await trx.insert(schema.groups, {
              id: generateId(),
              name: "Transaction",
            });
            const rand = Math.random();
            if (rand < 0.25) {
              throw new Error("Transaction failed");
            } else if (rand >= 0.25 && rand < 0.5) {
              await rollback();
              return "Transaction rolled back";
            } else {
              await commit();
              return "Transaction successful";
            }
          });
        }),
      })),
    cards: publicRoute.collectionRoute(schema.cards, {
      // read: (ctx) => {
      //   console.log("Auth context", ctx);
      //   return {
      //     counter: {
      //       $gte: 1,
      //     },
      //   };
      // },
    }),
  },
});

export type Router = typeof routerImpl;
