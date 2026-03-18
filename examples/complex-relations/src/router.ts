import { routeFactory, router, createMiddleware } from "@live-state/sync/server";

import { schema } from "./schema";
import { generateId } from "../../../packages/live-state/src/core/utils";

/*
 * Routes
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

export const appRouter = router({
  schema,
  routes: {
    users: protectedRoute
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
    organizations: protectedRoute.collectionRoute(schema.organizations),
    userOrganizations: protectedRoute.collectionRoute(schema.userOrganizations),
    posts: protectedRoute.collectionRoute(schema.posts, {
      read: ({ ctx }) => ({
        organization: {
          userOrganizations: {
            userId: ctx.user,
            role: "admin",
          },
        },
      }),
      update: {
        preMutation: ({ ctx }) => ({
          organization: {
            userOrganizations: {
              userId: ctx.user,
              role: "admin",
            },
          },
        }),
        postMutation: ({ ctx }) => ({
          organization: {
            userOrganizations: {
              userId: ctx.user,
              role: "admin",
            },
          },
        }),
      },
    }),
  },
});

export type Router = typeof appRouter;
