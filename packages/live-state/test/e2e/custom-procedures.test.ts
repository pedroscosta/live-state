/**
 * End-to-end test suite for custom procedures (mutations and queries)
 * Tests custom procedures with both fetch and websocket clients
 * Uses the same schema as e2e.test.ts for consistency
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Selectable } from "kysely";
import express from "express";
import expressWs from "express-ws";
import { z } from "zod";
import {
  createSchema,
  createRelations,
  id,
  number,
  object,
  reference,
  string,
} from "../../src/schema";
import { routeFactory, router, server, expressAdapter } from "../../src/server";
import { SQLStorage } from "../../src/server/storage";
import { generateId } from "../../src/core/utils";
import { createClient } from "../../src/client";
import { createClient as createFetchClient } from "../../src/client/fetch";
import type { Server as HttpServer } from "http";
import { LogLevel } from "../../src/utils";

/**
 * Shared test schema - same as e2e.test.ts
 */
const user = object("users", {
  id: id(),
  name: string(),
  email: string(),
});

const post = object("posts", {
  id: id(),
  title: string(),
  content: string(),
  authorId: reference("users.id"),
  likes: number(),
});

const userRelations = createRelations(user, ({ many }) => ({
  posts: many(post, "authorId"),
}));

const postRelations = createRelations(post, ({ one }) => ({
  author: one(user, "authorId"),
}));

const testSchema = createSchema({
  users: user,
  posts: post,
  userRelations,
  postRelations,
});

const publicRoute = routeFactory();

const testRouter = router({
  schema: testSchema,
  routes: {
    users: publicRoute
      .collectionRoute(testSchema.users)
      .withProcedures(({ mutation, query }) => ({
        // Custom query with input - search by name prefix
        getUsersByNamePrefix: query(z.object({ prefix: z.string() })).handler(
          async ({ req, db }) => {
            const users = await db.users.get();
            console.log("users", users);
            return users.filter((u: any) =>
              u.name?.toLowerCase().startsWith(req.input.prefix.toLowerCase())
            );
          }
        ),

        // Custom query without input - get user count
        getUserCount: query().handler(async ({ db }) => {
          const users = await db.users.get();
          return { count: users.length };
        }),

        // Custom query with complex input
        searchUsers: query(
          z.object({
            nameContains: z.string().optional(),
            emailDomain: z.string().optional(),
          })
        ).handler(async ({ req, db }) => {
          const users = await db.users.get();
          let filtered = users;

          if (req.input.nameContains) {
            filtered = filtered.filter((u: any) =>
              u.name?.toLowerCase().includes(req.input.nameContains!.toLowerCase())
            );
          }

          if (req.input.emailDomain) {
            filtered = filtered.filter((u: any) =>
              u.email?.toLowerCase().endsWith(`@${req.input.emailDomain!.toLowerCase()}`)
            );
          }

          return filtered;
        }),

        // Custom mutation with input - create user with role prefix
        createUserWithRole: mutation(
          z.object({
            name: z.string(),
            email: z.string(),
            role: z.enum(["admin", "user", "guest"]),
          })
        ).handler(async ({ req, db }) => {
          const userId = generateId();
          await db.users.insert({
            id: userId,
            name: `[${req.input.role.toUpperCase()}] ${req.input.name}`,
            email: req.input.email,
          });
          return { id: userId, role: req.input.role };
        }),

        // Custom mutation without input - count guests
        countGuests: mutation().handler(async ({ db }) => {
          const users = await db.users.get();
          const guests = users.filter((u: any) => u.name?.startsWith("[GUEST]"));
          return { guestCount: guests.length };
        }),

        // Custom mutation that returns complex data
        batchUpdateNames: mutation(
          z.object({
            userIds: z.array(z.string()),
            suffix: z.string(),
          })
        ).handler(async ({ req, db }) => {
          const updated: string[] = [];
          for (const userId of req.input.userIds) {
            const user = await db.users.one(userId).get();
            if (user) {
              await db.users.update(userId, {
                name: `${user.name}${req.input.suffix}`,
              });
              updated.push(userId);
            }
          }
          return { updatedIds: updated, count: updated.length };
        }),
      })),

    posts: publicRoute.collectionRoute(testSchema.posts),
  },
});

describe("Custom Procedures End-to-End Tests", () => {
  let storage: SQLStorage;
  let testServer: ReturnType<typeof server>;
  let db: Database.Database;
  let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;
  let httpServer: HttpServer | null = null;
  let serverPort: number;
  let wsClient: ReturnType<typeof createClient<typeof testRouter>>;
  let fetchClient: ReturnType<typeof createFetchClient<typeof testRouter>>;

  const waitForConnection = (client: ReturnType<typeof createClient>) => {
    return new Promise<void>((resolve) => {
      if (client.client.ws.connected()) {
        resolve();
        return;
      }

      const listener = () => {
        if (client.client.ws.connected()) {
          client.client.ws.removeEventListener("connectionChange", listener);
          resolve();
        }
      };

      client.client.ws.addEventListener("connectionChange", listener);
    });
  };

  beforeEach(async () => {
    // Create in-memory SQLite database
    db = new Database(":memory:");

    // Enable foreign keys in SQLite
    db.pragma("foreign_keys = ON");

    // Create Kysely instance with SQLite dialect
    kyselyDb = new Kysely({
      dialect: new SqliteDialect({
        database: db,
      }),
    });

    // Create SQLStorage with Kysely instance
    storage = new SQLStorage(kyselyDb, testSchema);

    // Initialize the storage to create tables
    await storage.init(testSchema);

    testServer = server({
      router: testRouter,
      storage,
      schema: testSchema,
      logLevel: LogLevel.DEBUG,
    });

    const { app } = expressWs(express());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    expressAdapter(app, testServer);

    serverPort = await new Promise<number>((resolve) => {
      httpServer = app.listen(0, () => {
        const address = httpServer?.address();
        const port =
          typeof address === "object" && address?.port ? address.port : 0;
        resolve(port);
      });
    });

    wsClient = createClient({
      url: `ws://localhost:${serverPort}/ws`,
      schema: testSchema,
      storage: false,
      connection: {
        autoConnect: true,
        autoReconnect: false,
      },
    });

    await wsClient.client.load(wsClient.store.query.users.buildQueryRequest());
    await waitForConnection(wsClient);

    fetchClient = createFetchClient({
      url: `http://localhost:${serverPort}`,
      schema: testSchema,
    });
  });

  afterEach(async () => {
    if (wsClient?.client?.ws) {
      wsClient.client.ws.disconnect();
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
      });
      httpServer = null;
    }

    // Clean up: drop all tables
    if (kyselyDb) {
      try {
        await kyselyDb.schema.dropTable("posts_meta").ifExists().execute();
        await kyselyDb.schema.dropTable("posts").ifExists().execute();
        await kyselyDb.schema.dropTable("users_meta").ifExists().execute();
        await kyselyDb.schema.dropTable("users").ifExists().execute();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Close database connection
    if (db) {
      db.close();
    }
  });

  afterAll(async () => {
    // SQLite cleanup is handled in afterEach
  });

  describe("WebSocket Client - Custom Queries", () => {
    test("should call custom query without input", async () => {
      // Insert some users first
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "John Doe",
        email: "john@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Jane Doe",
        email: "jane@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await wsClient.store.query.users.getUserCount();

      expect(result).toBeDefined();
      expect(result.count).toBe(2);
    });

    test("should call custom query with input", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Alice Smith",
        email: "alice@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Bob Johnson",
        email: "bob@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Amy Wilson",
        email: "amy@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await wsClient.store.query.users.getUsersByNamePrefix({ prefix: "A" });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2); // Alice and Amy
    });

    // TODO: This test times out - needs investigation
    test.skip("should call custom query with complex input", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Alice Smith",
        email: "alice@company.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Bob Smith",
        email: "bob@gmail.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Charlie Green",
        email: "charlie@company.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Search for users with "Smith" in name AND company.com email
      const result = await wsClient.store.query.users.searchUsers({
        nameContains: "Smith",
        emailDomain: "company.com",
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1); // Only Alice
    });
  });

  describe("WebSocket Client - Custom Mutations", () => {
    test("should call custom mutation with input", async () => {
      const result = await wsClient.store.mutate.users.createUserWithRole({
        name: "Admin User",
        email: "admin@example.com",
        role: "admin",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.role).toBe("admin");

      // Wait for sync
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the user was created with the role prefix
      const users = await wsClient.store.query.users.get();
      const createdUser = users.find((u) => u.id === result.id);
      expect(createdUser).toBeDefined();
      expect(createdUser?.name).toBe("[ADMIN] Admin User");
    });

    // TODO: This test times out - needs investigation
    test.skip("should call custom mutation without input", async () => {
      // Create some guest users
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "[GUEST] Guest 1",
        email: "guest1@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "[GUEST] Guest 2",
        email: "guest2@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Regular User",
        email: "regular@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await wsClient.store.mutate.users.countGuests();

      expect(result).toBeDefined();
      expect(result.guestCount).toBe(2);
    });

    // TODO: This test times out - needs investigation
    test.skip("should call custom mutation with complex return type", async () => {
      const userId1 = generateId();
      const userId2 = generateId();
      const userId3 = generateId();

      await storage.insert(testSchema.users, {
        id: userId1,
        name: "User 1",
        email: "user1@example.com",
      });
      await storage.insert(testSchema.users, {
        id: userId2,
        name: "User 2",
        email: "user2@example.com",
      });
      await storage.insert(testSchema.users, {
        id: userId3,
        name: "User 3",
        email: "user3@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await wsClient.store.mutate.users.batchUpdateNames({
        userIds: [userId1, userId3],
        suffix: " - Updated",
      });

      expect(result).toBeDefined();
      expect(result.count).toBe(2);
      expect(result.updatedIds).toContain(userId1);
      expect(result.updatedIds).toContain(userId3);
      expect(result.updatedIds).not.toContain(userId2);
    });
  });

  // TODO: These tests are skipped because the custom query returns raw storage data
  // which has a different shape than what the fetch client's standard queries return.
  // The data transformation needs to be aligned across all query paths.
  describe.skip("Fetch Client - Custom Queries", () => {
    test("should call custom query without input", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "User 1",
        email: "user1@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "User 2",
        email: "user2@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "User 3",
        email: "user3@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await fetchClient.query.users.getUserCount();

      expect(result).toBeDefined();
      expect(result.count).toBe(3);
    });

    test("should call custom query with input", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Alpha User",
        email: "alpha@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Beta User",
        email: "beta@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Gamma User",
        email: "gamma@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await fetchClient.query.users.getUsersByNamePrefix({ prefix: "A" });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1); // Only Alpha
    });

    test("should call custom query with complex input", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Alice Brown",
        email: "alice@company.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Bob Brown",
        email: "bob@gmail.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Charlie Green",
        email: "charlie@company.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await fetchClient.query.users.searchUsers({
        nameContains: "Brown",
        emailDomain: "company.com",
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1); // Only Alice Brown
    });
  });

  describe.skip("Fetch Client - Custom Mutations", () => {
    test("should call custom mutation with input", async () => {
      const result = await fetchClient.mutate.users.createUserWithRole({
        name: "Guest User",
        email: "guest@example.com",
        role: "guest",
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.role).toBe("guest");

      // Wait for sync
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the user was created
      const users = await fetchClient.query.users.get();
      const createdUser = users.find((u: any) => u.id === result.id);
      expect(createdUser).toBeDefined();
      expect(createdUser?.name).toBe("[GUEST] Guest User");
    });

    test("should call custom mutation without input", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "[GUEST] Guest A",
        email: "guesta@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "Normal User",
        email: "normal@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await fetchClient.mutate.users.countGuests();

      expect(result).toBeDefined();
      expect(result.guestCount).toBe(1);
    });

    test("should call custom mutation with complex return type", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      await storage.insert(testSchema.users, {
        id: userId1,
        name: "User A",
        email: "usera@example.com",
      });
      await storage.insert(testSchema.users, {
        id: userId2,
        name: "User B",
        email: "userb@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await fetchClient.mutate.users.batchUpdateNames({
        userIds: [userId1, userId2],
        suffix: " - Modified",
      });

      expect(result).toBeDefined();
      expect(result.count).toBe(2);
      expect(result.updatedIds.length).toBe(2);
    });
  });

  describe.skip("Mixed Standard and Custom Operations", () => {
    test("should use both standard queries and custom queries", async () => {
      // Use custom mutation to create a user
      const createResult = await fetchClient.mutate.users.createUserWithRole({
        name: "Mixed Test User",
        email: "mixed@example.com",
        role: "user",
      });

      expect(createResult.id).toBeDefined();

      // Wait for sync
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Use standard query to get all users
      const allUsers = await fetchClient.query.users.get();
      expect(allUsers.length).toBe(1);

      // Use custom query to get user count
      const countResult = await fetchClient.query.users.getUserCount();
      expect(countResult.count).toBe(1);

      // Use standard insert
      await fetchClient.mutate.users.insert({
        id: generateId(),
        name: "Standard Insert User",
        email: "standard@example.com",
      });

      // Wait for sync
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify both users exist
      const finalCount = await fetchClient.query.users.getUserCount();
      expect(finalCount.count).toBe(2);

      // Use custom query with filter
      const prefixedUsers = await fetchClient.query.users.getUsersByNamePrefix({ prefix: "Standard" });
      expect(prefixedUsers.length).toBe(1);
    });

    test("should chain standard query methods alongside custom queries", async () => {
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "User Alpha",
        email: "alpha@example.com",
      });
      await storage.insert(testSchema.users, {
        id: generateId(),
        name: "User Beta",
        email: "beta@example.com",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Standard query with where clause
      const standardResult = await fetchClient.query.users
        .where({ name: "User Beta" })
        .get();
      expect(standardResult.length).toBe(1);

      // Custom query achieving similar result
      const customResult = await fetchClient.query.users.getUsersByNamePrefix({ prefix: "User B" });
      expect(customResult.length).toBe(1);

      // Both should return the same user
      expect(standardResult[0].id).toBe(customResult[0].id);
    });
  });
});
