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
      .withProcedures(({ mutation, query }) => ({
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
        getStats: query().handler(async ({ db }) => {
          const allGroups = await db.find(schema.groups, {
            include: {
              cards: true,
            },
          });

          const totalGroups = Object.keys(allGroups).length;
          const totalCards = Object.values(allGroups).reduce(
            (sum, group) =>
              sum + (group.cards ? Object.keys(group.cards).length : 0),
            0
          );
          const groupsWithCards = Object.values(allGroups).filter(
            (group) => group.cards && Object.keys(group.cards).length > 0
          ).length;

          return {
            totalGroups,
            totalCards,
            groupsWithCards,
            averageCardsPerGroup:
              totalGroups > 0 ? (totalCards / totalGroups).toFixed(2) : "0.00",
          };
        }),
        searchByName: query(z.string().min(1)).handler(async ({ req, db }) => {
          const allGroups = await db.find(schema.groups, {
            include: {
              cards: true,
            },
          });

          const searchTerm = req.input!.toLowerCase();
          const matchingGroups = Object.values(allGroups).filter((group) =>
            group.name.toLowerCase().includes(searchTerm)
          );

          return matchingGroups.reduce(
            (acc, group) => {
              acc[group.id] = group;
              return acc;
            },
            {} as Record<string, (typeof matchingGroups)[0]>
          );
        }),
      })),
    cards: publicRoute.collectionRoute(schema.cards, {
      // insert: ({ ctx, value }) => {
      //   console.log("Insert auth context", ctx);
      //   console.log("Insert auth value", value);
      //   return Math.random() < 0.5;
      // },
      // read: (ctx) => {
      //   console.log("Auth context", ctx);
      //   return {
      //     counter: {
      //       $gte: 1,
      //     },
      //   };
      // },
      // insert: (ctx) => {
      //   return {
      //     counter: {
      //       $gte: 1,
      //     },
      //   };
      // },
      // update: {
      //   preMutation: (ctx) => {
      //     return {
      //       counter: { $gte: 0 },
      //     };
      //   },
      //   postMutation: (ctx) => {
      //     return {
      //       counter: { $gte: 2 },
      //     };
      //   },
      // },
    }),
  },
});

export type Router = typeof routerImpl;
