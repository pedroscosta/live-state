/*
 * Raw entities
 */

import {
  createRelations,
  createSchema,
  id,
  object,
  reference,
  string,
} from "@live-state/sync";

const user = object("users", {
  id: id(),
  name: string(),
});

const organization = object("organizations", {
  id: id(),
  name: string(),
});

const userOrganization = object("userOrganizations", {
  id: id(),
  userId: reference("users.id"),
  organizationId: reference("organizations.id"),
  role: string(),
});

const post = object("posts", {
  id: id(),
  title: string(),
  authorId: reference("users.id"),
  organizationId: reference("organizations.id"),
});

/*
 * Entities' relations
 */

const userRelations = createRelations(user, ({ many }) => ({
  userOrganizations: many(userOrganization, "userId"),
  posts: many(post, "authorId"),
}));

const organizationRelations = createRelations(organization, ({ many }) => ({
  userOrganizations: many(userOrganization, "organizationId"),
  posts: many(post, "organizationId"),
}));

const userOrganizationRelations = createRelations(
  userOrganization,
  ({ one }) => ({
    user: one(user, "userId"),
    organization: one(organization, "organizationId"),
  })
);

const postRelations = createRelations(post, ({ one }) => ({
  author: one(user, "authorId"),
  organization: one(organization, "organizationId"),
}));

export const schema = createSchema({
  user,
  organization,
  userOrganization,
  post,
  userRelations,
  organizationRelations,
  userOrganizationRelations,
  postRelations,
});
