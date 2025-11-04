/**
 * End-to-end test suite for the live-state library
 * Tests queries with both fetch and websocket clients
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { Pool } from "pg";
import express from "express";
import expressWs from "express-ws";
import {
  createRelations,
  createSchema,
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

/**
 * Test schema
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
    users: publicRoute.collectionRoute(testSchema.users),
    posts: publicRoute.collectionRoute(testSchema.posts),
  },
});

describe("End-to-End Query Tests", () => {
  let storage: SQLStorage;
  let testServer: ReturnType<typeof server>;
  let pool: Pool;
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
    // Create PostgreSQL connection pool
    pool = new Pool({
      connectionString:
        "postgresql://admin:admin@localhost:5432/live_state_test",
    });

    // Create SQL storage
    storage = new SQLStorage(pool);

    // Create server
    testServer = server({
      router: testRouter,
      storage,
      schema: testSchema,
    });

    // Wait for storage to initialize
    // await storage.init(testSchema);

    // Clean up all tables before each test
    try {
      await pool.query(
        "TRUNCATE TABLE users, users_meta, posts, posts_meta RESTART IDENTITY CASCADE"
      );
    } catch (error) {
      // Ignore errors if tables don't exist yet (first run)
      // They will be created by storage.init()
    }

    // Create Express server
    const { app } = expressWs(express());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    expressAdapter(app, testServer);

    // Start server on a random port
    serverPort = await new Promise<number>((resolve) => {
      httpServer = app.listen(0, () => {
        const address = httpServer?.address();
        const port =
          typeof address === "object" && address?.port ? address.port : 0;
        resolve(port);
      });
    });

    // Create websocket client and connect
    wsClient = createClient({
      url: `ws://localhost:${serverPort}/ws`,
      schema: testSchema,
      storage: false,
      connection: {
        autoConnect: true,
        autoReconnect: false,
      },
    });

    wsClient.client.subscribe();

    // Wait for websocket client to connect
    await waitForConnection(wsClient);

    // Create fetch client
    fetchClient = createFetchClient({
      url: `http://localhost:${serverPort}`,
      schema: testSchema,
    });
  });

  afterEach(async () => {
    // Disconnect websocket client
    if (wsClient?.client?.ws) {
      wsClient.client.ws.disconnect();
    }

    // Close HTTP server
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
      });
      httpServer = null;
    }

    // Clean up all tables after each test
    try {
      await pool.query(
        "TRUNCATE TABLE users, users_meta, posts, posts_meta RESTART IDENTITY CASCADE"
      );
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  afterAll(async () => {
    // Close the pool after all tests
    await pool.end();
  });

  describe("Websocket Client Tests", () => {
    describe("Empty Query", () => {
      test("should handle empty query", async () => {
        const result = await wsClient.store.query.users.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });
    });

    describe("Query with Data", () => {
      test("should handle query that returns data", async () => {
        const userId = generateId();
        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await wsClient.store.query.users.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const user = result[0];
        expect(user).toBeDefined();
        expect(user.id).toBe(userId);
        expect(user.name).toBe("John Doe");
        expect(user.email).toBe("john@example.com");
      });
    });

    describe("Query with Shallow Include", () => {
      test("should handle query with shallow include (one relation)", async () => {
        const userId = generateId();
        const postId = generateId();

        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        await storage.insert(testSchema.posts, {
          id: postId,
          title: "Test Post",
          content: "Test Content",
          authorId: userId,
          likes: 0,
        });

        wsClient.client.ws.disconnect();
        wsClient.client.ws.connect();
        await waitForConnection(wsClient);

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await wsClient.store.query.posts
          .include({ author: true })
          .get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const post = result[0];
        expect(post).toBeDefined();
        expect(post.id).toBe(postId);
        expect(post.title).toBe("Test Post");

        // Check included author relation
        const author = post.author;
        expect(author).toBeDefined();
        expect(author?.id).toBe(userId);
        expect(author?.name).toBe("John Doe");
      });

      test("should handle query with shallow include (many relation)", async () => {
        const userId = generateId();
        const postId1 = generateId();
        const postId2 = generateId();

        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        await storage.insert(testSchema.posts, {
          id: postId1,
          title: "Post 1",
          content: "Content 1",
          authorId: userId,
          likes: 0,
        });

        await storage.insert(testSchema.posts, {
          id: postId2,
          title: "Post 2",
          content: "Content 2",
          authorId: userId,
          likes: 0,
        });

        wsClient.client.ws.disconnect();
        wsClient.client.ws.connect();
        await waitForConnection(wsClient);

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await wsClient.store.query.users
          .include({ posts: true })
          .get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const user = result[0];
        expect(user).toBeDefined();
        expect(user.id).toBe(userId);

        // Check included posts relation (many)
        const posts = user.posts;
        expect(posts).toBeDefined();
        expect(Array.isArray(posts)).toBe(true);
        expect(posts.length).toBe(2);

        const postIds = posts.map((p: any) => p.id) as string[];
        expect(postIds).toContain(postId1);
        expect(postIds).toContain(postId2);
      });
    });

    describe("Query with Nested Include", () => {
      test("should handle query with nested include", async () => {
        const userId = generateId();
        const postId1 = generateId();
        const postId2 = generateId();

        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        await storage.insert(testSchema.posts, {
          id: postId1,
          title: "Post 1",
          content: "Content 1",
          authorId: userId,
          likes: 0,
        });

        await storage.insert(testSchema.posts, {
          id: postId2,
          title: "Post 2",
          content: "Content 2",
          authorId: userId,
          likes: 0,
        });

        wsClient.client.ws.disconnect();
        wsClient.client.ws.connect();
        await waitForConnection(wsClient);

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await wsClient.store.query.users
          .include({
            posts: {
              author: true,
            },
          })
          .get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const user = result[0];
        expect(user).toBeDefined();
        expect(user.id).toBe(userId);
        expect(user.name).toBe("John Doe");

        // Check nested include: posts -> author
        const posts = user.posts;
        expect(posts).toBeDefined();
        expect(Array.isArray(posts)).toBe(true);
        expect(posts.length).toBe(2);

        // Each post should have its author included
        for (const post of posts) {
          const author = post.author;
          expect(author).toBeDefined();
          expect(author?.id).toBe(userId);
          expect(author?.name).toBe("John Doe");
        }
      });
    });
  });

  describe("Fetch Client Tests", () => {
    describe("Empty Query", () => {
      test("should handle empty query", async () => {
        const result = await fetchClient.query.users.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });
    });

    describe("Query with Data", () => {
      test("should handle query that returns data", async () => {
        const userId = generateId();
        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await fetchClient.query.users.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const user = result[0];
        expect(user).toBeDefined();
        expect(user.id).toBe(userId);
        expect(user.name).toBe("John Doe");
        expect(user.email).toBe("john@example.com");
      });
    });

    describe("Query with Shallow Include", () => {
      test("should handle query with shallow include (one relation)", async () => {
        const userId = generateId();
        const postId = generateId();

        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        await storage.insert(testSchema.posts, {
          id: postId,
          title: "Test Post",
          content: "Test Content",
          authorId: userId,
          likes: 0,
        });

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await fetchClient.query.posts
          .include({ author: true })
          .get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const post = result[0];
        expect(post).toBeDefined();
        expect(post.id).toBe(postId);
        expect(post.title).toBe("Test Post");

        // Check included author relation
        const author = post.author;
        expect(author).toBeDefined();
        expect(author?.id).toBe(userId);
        expect(author?.name).toBe("John Doe");
      });

      test("should handle query with shallow include (many relation)", async () => {
        const userId = generateId();
        const postId1 = generateId();
        const postId2 = generateId();

        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        await storage.insert(testSchema.posts, {
          id: postId1,
          title: "Post 1",
          content: "Content 1",
          authorId: userId,
          likes: 0,
        });

        await storage.insert(testSchema.posts, {
          id: postId2,
          title: "Post 2",
          content: "Content 2",
          authorId: userId,
          likes: 0,
        });

        wsClient.client.ws.disconnect();
        wsClient.client.ws.connect();
        await waitForConnection(wsClient);

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await fetchClient.query.users
          .include({ posts: true })
          .get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const user = result[0];
        expect(user).toBeDefined();
        expect(user.id).toBe(userId);

        // Check included posts relation (many)
        const posts = user.posts;
        expect(posts).toBeDefined();
        expect(Array.isArray(posts)).toBe(true);
        expect(posts.length).toBe(2);

        const postIds = posts.map((p: any) => p.id) as string[];
        expect(postIds).toContain(postId1);
        expect(postIds).toContain(postId2);
      });
    });

    describe("Query with Nested Include", () => {
      test("should handle query with nested include", async () => {
        const userId = generateId();
        const postId1 = generateId();
        const postId2 = generateId();

        await storage.insert(testSchema.users, {
          id: userId,
          name: "John Doe",
          email: "john@example.com",
        });

        await storage.insert(testSchema.posts, {
          id: postId1,
          title: "Post 1",
          content: "Content 1",
          authorId: userId,
          likes: 0,
        });

        await storage.insert(testSchema.posts, {
          id: postId2,
          title: "Post 2",
          content: "Content 2",
          authorId: userId,
          likes: 0,
        });

        wsClient.client.ws.disconnect();
        wsClient.client.ws.connect();
        await waitForConnection(wsClient);

        // Wait a bit for sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await fetchClient.query.users
          .include({
            posts: {
              author: true,
            },
          })
          .get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const user = result[0];
        expect(user).toBeDefined();
        expect(user.id).toBe(userId);
        expect(user.name).toBe("John Doe");

        // Check nested include: posts -> author
        const posts = user.posts;
        expect(posts).toBeDefined();
        expect(Array.isArray(posts)).toBe(true);
        expect(posts.length).toBe(2);

        // Each post should have its author included
        for (const post of posts) {
          const author = post.author;
          expect(author).toBeDefined();
          expect(author?.id).toBe(userId);
          expect(author?.name).toBe("John Doe");
        }
      });
    });
  });
});
