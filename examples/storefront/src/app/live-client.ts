import {
  createClient,
  defineOptimisticMutations,
} from "@live-state/sync/client";
import { type Router } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";
import { LogLevel } from "@live-state/sync";

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
    incrementCounter: ({ input, storage }) => {
      const card = storage.cards.one(input.cardId).get();
      if (card) {
        storage.cards.update(input.cardId, {
          counter: card.counter + 1,
        });
      }
    },
    decrementCounter: ({ input, storage }) => {
      const card = storage.cards.one(input.cardId).get();
      if (card) {
        storage.cards.update(input.cardId, {
          counter: card.counter - 1,
        });
      }
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
