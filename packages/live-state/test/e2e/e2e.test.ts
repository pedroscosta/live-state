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

    describe("Multi-Client Mutation Sync", () => {
      let client1: ReturnType<typeof createClient<typeof testRouter>>;
      let client2: ReturnType<typeof createClient<typeof testRouter>>;

      beforeEach(async () => {
        // Create first websocket client
        client1 = createClient({
          url: `ws://localhost:${serverPort}/ws`,
          schema: testSchema,
          storage: false,
          connection: {
            autoConnect: true,
            autoReconnect: false,
          },
        });

        client1.client.subscribe();

        // Wait for first client to connect
        await waitForConnection(client1);

        // Create second websocket client
        client2 = createClient({
          url: `ws://localhost:${serverPort}/ws`,
          schema: testSchema,
          storage: false,
          connection: {
            autoConnect: true,
            autoReconnect: false,
          },
        });

        client2.client.subscribe();

        // Wait for second client to connect
        await waitForConnection(client2);
      });

      afterEach(async () => {
        // Disconnect both clients
        if (client1?.client?.ws) {
          client1.client.ws.disconnect();
        }
        if (client2?.client?.ws) {
          client2.client.ws.disconnect();
        }
      });

      test("should receive INSERT mutation from another client", async () => {
        const userId = generateId();
        const userName = "Jane Doe";
        const userEmail = "jane@example.com";

        // Subscribe client2 to users collection to receive updates
        const receivedUpdates: any[] = [];
        const unsubscribe = client2.store.query.users.subscribe((users) => {
          receivedUpdates.push(users);
        });

        // Wait a bit for subscription to be established
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client1 performs INSERT mutation
        client1.store.mutate.users.insert({
          id: userId,
          name: userName,
          email: userEmail,
        });

        // Wait for mutation to propagate
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify client2 received the update
        expect(receivedUpdates.length).toBeGreaterThan(0);

        const latestUpdate = receivedUpdates[receivedUpdates.length - 1];
        expect(Array.isArray(latestUpdate)).toBe(true);

        const user = latestUpdate.find((u: any) => u.id === userId);
        expect(user).toBeDefined();
        expect(user?.name).toBe(userName);
        expect(user?.email).toBe(userEmail);

        // Verify client2 can query the data
        const queryResult = await client2.store.query.users.get();
        const queriedUser = queryResult.find((u: any) => u.id === userId);
        expect(queriedUser).toBeDefined();
        expect(queriedUser?.name).toBe(userName);
        expect(queriedUser?.email).toBe(userEmail);

        unsubscribe();
      });

      test("should receive UPDATE mutation from another client", async () => {
        const userId = generateId();
        const initialName = "John Doe";
        const updatedName = "John Updated";

        // First, insert a user via storage
        await storage.insert(testSchema.users, {
          id: userId,
          name: initialName,
          email: "john@example.com",
        });

        // Wait for initial sync
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Subscribe client2 to users collection
        const receivedUpdates: any[] = [];
        const unsubscribe = client2.store.query.users.subscribe((users) => {
          receivedUpdates.push(users);
        });

        // Wait a bit for subscription
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client1 performs UPDATE mutation
        client1.store.mutate.users.update(userId, {
          name: updatedName,
        });

        // Wait for mutation to propagate
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify client2 received the update
        expect(receivedUpdates.length).toBeGreaterThan(0);

        const latestUpdate = receivedUpdates[receivedUpdates.length - 1];
        expect(Array.isArray(latestUpdate)).toBe(true);

        const user = latestUpdate.find((u: any) => u.id === userId);
        expect(user).toBeDefined();
        expect(user?.name).toBe(updatedName);

        // Verify client2 can query the updated data
        const queryResult = await client2.store.query.users.get();
        const queriedUser = queryResult.find((u: any) => u.id === userId);
        expect(queriedUser).toBeDefined();
        expect(queriedUser?.name).toBe(updatedName);

        unsubscribe();
      });

      test("should receive multiple mutations from another client", async () => {
        const userId1 = generateId();
        const userId2 = generateId();

        // Subscribe client2 to users collection
        const receivedUpdates: any[] = [];
        const unsubscribe = client2.store.query.users.subscribe((users) => {
          receivedUpdates.push(users);
        });

        // Wait a bit for subscription
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client1 performs first INSERT mutation
        client1.store.mutate.users.insert({
          id: userId1,
          name: "User 1",
          email: "user1@example.com",
        });

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client1 performs second INSERT mutation
        client1.store.mutate.users.insert({
          id: userId2,
          name: "User 2",
          email: "user2@example.com",
        });

        // Wait for mutations to propagate
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify client2 received updates
        expect(receivedUpdates.length).toBeGreaterThan(0);

        const latestUpdate = receivedUpdates[receivedUpdates.length - 1];
        expect(Array.isArray(latestUpdate)).toBe(true);
        expect(latestUpdate.length).toBeGreaterThanOrEqual(2);

        const user1 = latestUpdate.find((u: any) => u.id === userId1);
        const user2 = latestUpdate.find((u: any) => u.id === userId2);

        expect(user1).toBeDefined();
        expect(user1?.name).toBe("User 1");
        expect(user2).toBeDefined();
        expect(user2?.name).toBe("User 2");

        // Verify client2 can query all users
        const queryResult = await client2.store.query.users.get();
        const queriedUser1 = queryResult.find((u: any) => u.id === userId1);
        const queriedUser2 = queryResult.find((u: any) => u.id === userId2);

        expect(queriedUser1).toBeDefined();
        expect(queriedUser2).toBeDefined();

        unsubscribe();
      });

      test("should receive mutations on related resources", async () => {
        const userId = generateId();
        const postId = generateId();

        // Subscribe client2 to posts collection
        const receivedUpdates: any[] = [];
        const unsubscribe = client2.store.query.posts.subscribe((posts) => {
          receivedUpdates.push(posts);
        });

        // Wait a bit for subscription
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client1 first creates a user, then a post
        client1.store.mutate.users.insert({
          id: userId,
          name: "Author",
          email: "author@example.com",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        client1.store.mutate.posts.insert({
          id: postId,
          title: "New Post",
          content: "Post Content",
          authorId: userId,
          likes: 0,
        });

        // Wait for mutations to propagate
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify client2 received the post update
        expect(receivedUpdates.length).toBeGreaterThan(0);

        const latestUpdate = receivedUpdates[receivedUpdates.length - 1];
        expect(Array.isArray(latestUpdate)).toBe(true);

        const post = latestUpdate.find((p: any) => p.id === postId);
        expect(post).toBeDefined();
        expect(post?.title).toBe("New Post");
        expect(post?.authorId).toBe(userId);

        // Verify client2 can query the post
        const queryResult = await client2.store.query.posts.get();
        const queriedPost = queryResult.find((p: any) => p.id === postId);
        expect(queriedPost).toBeDefined();
        expect(queriedPost?.title).toBe("New Post");

        unsubscribe();
      });

      test("should receive mutations when both clients are subscribed to same resource", async () => {
        const userId = generateId();

        // Subscribe both clients to users collection
        const client1Updates: any[] = [];
        const client2Updates: any[] = [];

        const unsubscribe1 = client1.store.query.users.subscribe((users) => {
          client1Updates.push(users);
        });

        const unsubscribe2 = client2.store.query.users.subscribe((users) => {
          client2Updates.push(users);
        });

        // Wait a bit for subscriptions
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Client1 performs INSERT mutation
        client1.store.mutate.users.insert({
          id: userId,
          name: "Test User",
          email: "test@example.com",
        });

        // Wait for mutation to propagate
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify both clients received updates
        expect(client1Updates.length).toBeGreaterThan(0);
        expect(client2Updates.length).toBeGreaterThan(0);

        const client1Latest = client1Updates[client1Updates.length - 1];
        const client2Latest = client2Updates[client2Updates.length - 1];

        const client1User = client1Latest.find((u: any) => u.id === userId);
        const client2User = client2Latest.find((u: any) => u.id === userId);

        expect(client1User).toBeDefined();
        expect(client1User?.name).toBe("Test User");
        expect(client2User).toBeDefined();
        expect(client2User?.name).toBe("Test User");

        unsubscribe1();
        unsubscribe2();
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
