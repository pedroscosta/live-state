/*
 * Raw entities
 */

import {
  createRelations,
  createSchema,
  number,
  object,
  string,
} from "@live-state/sync";

const group = object("groups", {
  id: string(),
  name: string(),
});

const card = object("cards", {
  id: string(),
  name: string(),
  counter: number(),
  groupId: string(),
});

/*
 * Entities' relations
 */

const groupRelations = createRelations(group, ({ many }) => ({
  cards: many(card, "groupId"),
}));

const cardRelations = createRelations(card, ({ one }) => ({
  group: one(group, "groupId"),
}));

export const schema = createSchema({
  group,
  card,
  groupRelations,
  cardRelations,
});
