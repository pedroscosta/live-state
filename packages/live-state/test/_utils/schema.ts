// Should replace
/*
 * Raw entities
 */

import {
  createRelations,
  createSchema,
  id,
  number,
  object,
  reference,
  string,
} from "@live-state/sync";

const group = object("groups", {
  id: id(),
  name: string(),
});

const card = object("cards", {
  id: id(),
  name: string(),
  counter: number(),
  groupId: reference("groups.id"),
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
