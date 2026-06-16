import {
  createClient,
  defineOptimisticMutations,
} from "@live-state/sync/client";
import { type Router } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";
import { LogLevel } from "@live-state/sync";

/*
 * Optimistic handlers are registered for ONLY a subset of the custom mutations.
 * Anything not listed here runs without optimism — the UI waits for the server
 * round-trip (the server adds an artificial delay to most procedures so the
 * difference is easy to see).
 *
 *   Optimistic:      createGroup, createCard, incrementCounter, moveCard
 *   Non-optimistic:  renameGroup, decrementCounter, renameCard, seed
 */
const optimisticMutations = defineOptimisticMutations<Router, typeof schema>({
  groups: {
    createGroup: ({ input, storage }) => {
      storage.groups.insert({
        id: input.id,
        name: input.name,
      });
    },
  },
  cards: {
    createCard: ({ input, storage }) => {
      storage.cards.insert({
        id: input.id,
        name: input.name,
        counter: 0,
        groupId: input.groupId,
      });
    },
    incrementCounter: ({ input, storage }) => {
      const card = storage.cards.one(input.cardId).get();
      if (card) {
        storage.cards.update(input.cardId, {
          counter: card.counter + 1,
        });
      }
    },
    moveCard: ({ input, storage }) => {
      storage.cards.update(input.cardId, {
        groupId: input.groupId,
      });
    },
  },
});

export const { store, client } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
  storage: false,
  logLevel: LogLevel.DEBUG,
  optimisticMutations,
});
