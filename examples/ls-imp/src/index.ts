import { routeFactory, router } from "@live-state/sync/server";
import { z } from "zod";

import { generateId } from "../../../packages/live-state/src/core/utils";
import { schema } from "./schema";

/*
 * Routes
 *
 * Every write goes through an explicitly-defined custom procedure — there are no
 * default `insert`/`update` mutations in use here. Some of these procedures have
 * matching optimistic handlers registered on the client (see the storefront's
 * `live-client.ts`) and some intentionally do NOT, so the two behaviours can be
 * compared side by side. Each procedure is tagged below:
 *
 *   [OPTIMISTIC]     -> client applies the change instantly, then reconciles.
 *   [NON-OPTIMISTIC] -> UI waits for the server round-trip before updating.
 *
 * A few procedures keep an artificial delay so the difference is obvious.
 */

const publicRoute = routeFactory();

const SERVER_DELAY_MS = 2_000;
const delay = (ms = SERVER_DELAY_MS) => new Promise((r) => setTimeout(r, ms));

export const routerImpl = router({
  schema,
  routes: {
    groups: publicRoute
      .collectionRoute(schema.groups)
      .withProcedures(({ mutation, query }) => ({
        // [OPTIMISTIC] new group shows up immediately, confirmed after the delay.
        createGroup: mutation(
          z.object({ id: z.string(), name: z.string() }),
        ).handler(async ({ req, db }) => {
          await delay();
          return db.groups.insert({
            id: req.input.id,
            name: req.input.name,
          });
        }),

        // [NON-OPTIMISTIC] rename only lands after the server replies — the UI
        // lags by the delay on purpose so the contrast with createGroup is clear.
        renameGroup: mutation(
          z.object({ id: z.string(), name: z.string() }),
        ).handler(async ({ req, db }) => {
          await delay();
          return db.groups.update(req.input.id, { name: req.input.name });
        }),

        // Seeds a group with a couple of cards. Handy for resetting the demo.
        seed: mutation().handler(async ({ db }) => {
          const groupId = generateId();
          await db.groups.insert({ id: groupId, name: "Seeded group" });
          await db.cards.insert({
            id: generateId(),
            name: "Card A",
            counter: 0,
            groupId,
          });
          await db.cards.insert({
            id: generateId(),
            name: "Card B",
            counter: 0,
            groupId,
          });
          return { success: true, groupId };
        }),

        // [LIVE QUERY] returns an UNRESOLVED query builder (no `.get()`), so the
        // client can subscribe to it: `store.query.groups.listGroups()` is a
        // loadable that feeds the store and stays live. Use it with useLoadData
        // (or useLiveQuery) instead of the default collection query.
        listGroups: query().handler(async ({ db }) =>
          db.groups.where({}).include({ cards: true }),
        ),

        getStats: query().handler(async ({ db }) => {
          const allGroups = await db.find(schema.groups, {
            include: { cards: true },
          });

          const totalGroups = Object.keys(allGroups).length;
          const totalCards = Object.values(allGroups).reduce(
            (sum, group) =>
              sum + (group.cards ? Object.keys(group.cards).length : 0),
            0,
          );
          const groupsWithCards = Object.values(allGroups).filter(
            (group) => group.cards && Object.keys(group.cards).length > 0,
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
            include: { cards: true },
          });

          const searchTerm = req.input.toLowerCase();
          const matchingGroups = Object.values(allGroups).filter((group) =>
            group.name.toLowerCase().includes(searchTerm),
          );

          return matchingGroups.reduce(
            (acc, group) => {
              acc[group.id] = group;
              return acc;
            },
            {} as Record<string, (typeof matchingGroups)[0]>,
          );
        }),
      })),
    cards: publicRoute
      .collectionRoute(schema.cards)
      .withProcedures(({ mutation }) => ({
        // [OPTIMISTIC] card appears instantly inside its group.
        createCard: mutation(
          z.object({
            id: z.string(),
            name: z.string(),
            groupId: z.string(),
          }),
        ).handler(async ({ req, db }) => {
          return db.cards.insert({
            id: req.input.id,
            name: req.input.name,
            counter: 0,
            groupId: req.input.groupId,
          });
        }),

        // [OPTIMISTIC] counter bumps up immediately despite the server delay.
        incrementCounter: mutation(
          z.object({ cardId: z.string() }),
        ).handler(async ({ req, db }) => {
          await delay();
          const card = await db.cards.one(req.input.cardId).get();
          if (!card) throw new Error("Card not found");
          return db.cards.update(req.input.cardId, {
            counter: card.counter + 1,
          });
        }),

        // [NON-OPTIMISTIC] same operation, but with no optimistic handler — the
        // counter only changes after the delay so you can feel the round-trip.
        decrementCounter: mutation(
          z.object({ cardId: z.string() }),
        ).handler(async ({ req, db }) => {
          await delay();
          const card = await db.cards.one(req.input.cardId).get();
          if (!card) throw new Error("Card not found");
          return db.cards.update(req.input.cardId, {
            counter: card.counter - 1,
          });
        }),

        // [OPTIMISTIC] drag-and-drop needs instant feedback to feel right.
        moveCard: mutation(
          z.object({ cardId: z.string(), groupId: z.string() }),
        ).handler(async ({ req, db }) => {
          return db.cards.update(req.input.cardId, {
            groupId: req.input.groupId,
          });
        }),

        // [NON-OPTIMISTIC] rename waits for the server.
        renameCard: mutation(
          z.object({ cardId: z.string(), name: z.string() }),
        ).handler(async ({ req, db }) => {
          await delay();
          return db.cards.update(req.input.cardId, { name: req.input.name });
        }),
      })),
  },
});

export type Router = typeof routerImpl;
