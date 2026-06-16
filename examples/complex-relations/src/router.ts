import { createMiddleware, routeFactory, router } from "@live-state/sync/server";
import { z } from "zod";

import { generateId } from "../../../packages/live-state/src/core/utils";
import { schema } from "./schema";

/*
 * Routes
 *
 * This example uses ONLY custom procedures for every write — there are no
 * default `insert`/`update` mutations. Authorization that used to live in the
 * declarative `insert`/`update` handlers is now done inline inside each mutation
 * handler. Read-level authorization (query filtering) still lives on the route,
 * since that is not a mutation.
 */

type AppContext = { user: string };

const publicRoute = routeFactory();

const authMiddleware = createMiddleware<Record<string, any>, AppContext>(
  ({ ctx, next }) => {
    if (!ctx.user) {
      throw new Error("Unauthorized");
    }
    return next({ user: ctx.user });
  },
);

const protectedRoute = routeFactory<typeof schema>().use(authMiddleware);

/**
 * Throws unless `userId` is an admin of `organizationId`. Replaces the
 * declarative `update.preMutation` / `read` authorization the route used to
 * carry for posts.
 */
const assertOrgAdmin = async (
  db: any,
  userId: string,
  organizationId: string,
) => {
  const memberships = await db.userOrganizations
    .where({ userId, organizationId, role: "admin" })
    .get();
  if (Object.keys(memberships ?? {}).length === 0) {
    throw new Error("Unauthorized: must be an admin of the organization");
  }
};

export const appRouter = router({
  schema,
  routes: {
    users: protectedRoute
      .collectionRoute(schema.users)
      .withProcedures(({ mutation }) => ({
        // Seeds a user + organization + membership + first post.
        setup: mutation().handler(async ({ db }) => {
          const userId = generateId();
          const organizationId = generateId();

          await db.users.insert({ id: userId, name: "John Doe" });
          await db.organizations.insert({
            id: organizationId,
            name: "Organization",
          });
          await db.userOrganizations.insert({
            id: generateId(),
            userId,
            organizationId,
            role: "admin",
          });
          await db.posts.insert({
            id: generateId(),
            title: "Post 1",
            authorId: userId,
            organizationId,
          });

          return { success: true, userId, organizationId };
        }),

        createUser: mutation(z.object({ name: z.string() })).handler(
          async ({ req, db }) => {
            return db.users.insert({
              id: generateId(),
              name: req.input.name,
            });
          },
        ),
      })),
    organizations: protectedRoute
      .collectionRoute(schema.organizations)
      .withProcedures(({ mutation }) => ({
        // Creating an org also makes the caller its admin.
        createOrganization: mutation(z.object({ name: z.string() })).handler(
          async ({ req, db }) => {
            const organizationId = generateId();
            const organization = await db.organizations.insert({
              id: organizationId,
              name: req.input.name,
            });
            await db.userOrganizations.insert({
              id: generateId(),
              userId: req.context.user,
              organizationId,
              role: "admin",
            });
            return organization;
          },
        ),
      })),
    userOrganizations: protectedRoute
      .collectionRoute(schema.userOrganizations)
      .withProcedures(({ mutation }) => ({
        // Only an admin of the org may add new members.
        addMember: mutation(
          z.object({
            userId: z.string(),
            organizationId: z.string(),
            role: z.string(),
          }),
        ).handler(async ({ req, db }) => {
          await assertOrgAdmin(db, req.context.user, req.input.organizationId);
          return db.userOrganizations.insert({
            id: generateId(),
            userId: req.input.userId,
            organizationId: req.input.organizationId,
            role: req.input.role,
          });
        }),
      })),
    posts: protectedRoute
      .collectionRoute(schema.posts, {
        // Read authorization stays declarative — it filters queries, it is not
        // a mutation. Members only see posts of orgs where they are admins.
        read: ({ ctx }) => ({
          organization: {
            userOrganizations: {
              userId: ctx.user,
              role: "admin",
            },
          },
        }),
      })
      .withProcedures(({ mutation }) => ({
        createPost: mutation(
          z.object({ title: z.string(), organizationId: z.string() }),
        ).handler(async ({ req, db }) => {
          await assertOrgAdmin(db, req.context.user, req.input.organizationId);
          return db.posts.insert({
            id: generateId(),
            title: req.input.title,
            authorId: req.context.user,
            organizationId: req.input.organizationId,
          });
        }),

        updatePost: mutation(
          z.object({ id: z.string(), title: z.string() }),
        ).handler(async ({ req, db }) => {
          const post = await db.posts.one(req.input.id).get();
          if (!post) throw new Error("Post not found");
          await assertOrgAdmin(db, req.context.user, post.organizationId);
          return db.posts.update(req.input.id, { title: req.input.title });
        }),
      })),
  },
});

export type Router = typeof appRouter;
