import { routeFactory, router } from "@live-state/sync/server";

import { schema } from "./schema";
import { generateId } from "../../../packages/live-state/src/core/utils";

/*
 * Routes
 */

const publicRoute = routeFactory();

export const appRouter = router({
  schema,
  routes: {
    users: publicRoute
      .collectionRoute(schema.users)
      .withMutations(({ mutation }) => ({
        setup: mutation().handler(async ({ req, db }) => {
          const userId = generateId();
          const organizationId = generateId();

          await db.insert(schema.users, {
            id: userId,
            name: "John Doe",
          });

          await db.insert(schema.organizations, {
            id: organizationId,
            name: "Organization",
          });

          await db.insert(schema.userOrganizations, {
            id: generateId(),
            userId,
            organizationId,
            role: "admin",
          });

          await db.insert(schema.posts, {
            id: generateId(),
            title: "Post 1",
            authorId: userId,
            organizationId,
          });

          return {
            success: true,
          };
        }),
      })),
    organizations: publicRoute.collectionRoute(schema.organizations),
    userOrganizations: publicRoute.collectionRoute(schema.userOrganizations),
    posts: publicRoute.collectionRoute(schema.posts),
  },
});

export type Router = typeof appRouter;
