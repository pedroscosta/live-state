/**
 * End-to-end test suite for the live-state library
 * Tests queries with both fetch and websocket clients
 */

import {
  afterAll,
  afterEach,
  beforeAll,
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
  enumType,
  id,
  json,
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

  // Create a single shared pool for all tests to prevent connection leaks
  beforeAll(async () => {
    pool = new Pool({
      connectionString:
        "postgresql://admin:admin@localhost:5432/live_state_e2e_test",
      max: 10, // Limit pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  });

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
    // Create SQL storage using the shared pool
    storage = new SQLStorage(pool);

    // Create server
    testServer = server({
      router: testRouter,
      storage,
      schema: testSchema,
      logLevel: LogLevel.DEBUG,
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

    await wsClient.client.load(wsClient.store.query.users.buildQueryRequest());
    await wsClient.client.load(wsClient.store.query.posts.buildQueryRequest());

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
    if (pool) {
      try {
        await pool.query(
          "TRUNCATE TABLE users, users_meta, posts, posts_meta RESTART IDENTITY CASCADE"
        );
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  });

  afterAll(async () => {
    // Close the shared pool after all tests
    if (pool) {
      await pool.end();
    }
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

        await client1.client.load(
          client1.store.query.users.buildQueryRequest()
        );
        await client1.client.load(
          client1.store.query.posts.buildQueryRequest()
        );

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

        await client2.client.load(
          client2.store.query.users.buildQueryRequest()
        );
        await client2.client.load(
          client2.store.query.posts.buildQueryRequest()
        );

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

  describe("Authorization Where Clause Filtering", () => {
    let authorizedRouter: ReturnType<typeof router>;
    let authorizedServer: ReturnType<typeof server>;
    let authorizedHttpServer: HttpServer | null = null;
    let authorizedServerPort: number;
    let client1: ReturnType<typeof createClient<typeof authorizedRouter>>;
    let client2: ReturnType<typeof createClient<typeof authorizedRouter>>;

    beforeEach(async () => {
      // Create router with authorization
      const authorizedRoute = routeFactory();
      authorizedRouter = router({
        schema: testSchema,
        routes: {
          users: authorizedRoute.collectionRoute(testSchema.users, {
            read: ({ ctx }) => {
              // Only allow users to see their own data
              if (ctx.userId) {
                return { id: ctx.userId };
              }
              return false;
            },
          }),
          posts: authorizedRoute.collectionRoute(testSchema.posts),
        },
      });

      // Create server with context provider
      authorizedServer = server({
        router: authorizedRouter,
        storage,
        schema: testSchema,
        contextProvider: async ({ queryParams }) => {
          // Extract userId from query params for testing
          return {
            userId: queryParams["userId"],
          };
        },
      });

      // Create Express server
      const { app } = expressWs(express());
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      expressAdapter(app, authorizedServer);

      // Start server on a random port
      authorizedServerPort = await new Promise<number>((resolve) => {
        authorizedHttpServer = app.listen(0, () => {
          const address = authorizedHttpServer?.address();
          const port =
            typeof address === "object" && address?.port ? address.port : 0;
          resolve(port);
        });
      });

      // Create first client with userId1
      client1 = createClient({
        url: `ws://localhost:${authorizedServerPort}/ws?userId=user1`,
        schema: testSchema,
        storage: false,
        connection: {
          autoConnect: true,
          autoReconnect: false,
        },
        logLevel: LogLevel.DEBUG,
      });

      await client1.client.load(client1.store.query.users.buildQueryRequest());
      await waitForConnection(client1);

      // Create second client with userId2
      client2 = createClient({
        url: `ws://localhost:${authorizedServerPort}/ws?userId=user2`,
        schema: testSchema,
        storage: false,
        connection: {
          autoConnect: true,
          autoReconnect: false,
        },
        logLevel: LogLevel.DEBUG,
      });

      await client2.client.load(client2.store.query.users.buildQueryRequest());
      await waitForConnection(client2);
    });

    afterEach(async () => {
      // Disconnect clients
      if (client1?.client?.ws) {
        client1.client.ws.disconnect();
      }
      if (client2?.client?.ws) {
        client2.client.ws.disconnect();
      }

      // Close HTTP server
      if (authorizedHttpServer) {
        await new Promise<void>((resolve) => {
          authorizedHttpServer?.close(() => resolve());
        });
        authorizedHttpServer = null;
      }
    });

    test("should filter mutations based on authorization where clause", async () => {
      const user1Id = "user1";
      const user2Id = "user2";

      // Subscribe client1 to users collection FIRST
      const client1Updates: any[] = [];
      const unsubscribe1 = client1.store.query.users.subscribe((users) => {
        client1Updates.push(users);
      });

      // Subscribe client2 to users collection FIRST
      const client2Updates: any[] = [];
      const unsubscribe2 = client2.store.query.users.subscribe((users) => {
        client2Updates.push(users);
      });

      // Wait for subscriptions to be established
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert users via storage AFTER subscribing (so mutations are sent)
      await storage.insert(testSchema.users, {
        id: user1Id,
        name: "User 1",
        email: "user1@example.com",
      });

      await storage.insert(testSchema.users, {
        id: user2Id,
        name: "User 2",
        email: "user2@example.com",
      });

      // Wait for mutations to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Client1 should only receive updates for user1 (their own user)
      // Client1 should see user1 in their updates
      expect(client1Updates.length).toBeGreaterThan(0);
      const client1Latest = client1Updates[client1Updates.length - 1];
      const client1User1 = client1Latest.find((u: any) => u.id === user1Id);
      expect(client1User1).toBeDefined();
      expect(client1User1?.name).toBe("User 1");

      // Client1 should NOT see user2
      const client1User2 = client1Latest.find((u: any) => u.id === user2Id);
      expect(client1User2).toBeUndefined();

      // Client2 should only receive updates for user2 (their own user)
      expect(client2Updates.length).toBeGreaterThan(0);
      const client2Latest = client2Updates[client2Updates.length - 1];
      const client2User2 = client2Latest.find((u: any) => u.id === user2Id);
      expect(client2User2).toBeDefined();
      expect(client2User2?.name).toBe("User 2");

      // Client2 should NOT see user1
      const client2User1 = client2Latest.find((u: any) => u.id === user1Id);
      expect(client2User1).toBeUndefined();

      unsubscribe1();
      unsubscribe2();
    });

    test("should filter mutations when client performs mutation", async () => {
      const user2Id = "user2";

      // Insert user2 via storage first
      await storage.insert(testSchema.users, {
        id: user2Id,
        name: "User 2",
        email: "user2@example.com",
      });

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Subscribe client2 to users collection
      const client2Updates: any[] = [];
      const unsubscribe2 = client2.store.query.users.subscribe((users) => {
        client2Updates.push(users);
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Client1 performs INSERT mutation for their own user (should be allowed)
      const user1NewId = generateId();
      client1.store.mutate.users.insert({
        id: user1NewId,
        name: "User 1 New",
        email: "user1new@example.com",
      });

      // Wait for mutation to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Client2 should NOT receive the mutation because it's not authorized to see user1's data
      // Check the latest update - it should only contain user2
      if (client2Updates.length > 0) {
        const client2Latest = client2Updates[client2Updates.length - 1];
        const client2User1New = client2Latest.find(
          (u: any) => u.id === user1NewId
        );
        expect(client2User1New).toBeUndefined();

        // Client2 should still see user2
        const client2User2 = client2Latest.find((u: any) => u.id === user2Id);
        expect(client2User2).toBeDefined();
      }

      unsubscribe2();
    });

    test("should filter mutations based on merged where clauses (subscription + authorization)", async () => {
      const user1Id = "user1";

      // Subscribe client1 FIRST (no subscription where clause, just authorization)
      const client1Updates: any[] = [];
      const unsubscribe1 = client1.store.query.users.subscribe((users) => {
        client1Updates.push(users);
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert user1 via storage (should match authorization)
      await storage.insert(testSchema.users, {
        id: user1Id,
        name: "User 1",
        email: "user1@example.com",
      });

      // Wait for mutation to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Client1 should receive the update for user1 (matches authorization)
      expect(client1Updates.length).toBeGreaterThan(0);
      const client1Latest = client1Updates[client1Updates.length - 1];
      const client1User1 = client1Latest.find((u: any) => u.id === user1Id);
      expect(client1User1).toBeDefined();
      expect(client1User1?.name).toBe("User 1");

      // Now update user1's name (should still match authorization)
      await storage.update(testSchema.users, user1Id, {
        name: "User 1 Updated",
      });

      // Wait for mutations to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Client1 should receive the update
      const client1LatestAfterUpdate =
        client1Updates[client1Updates.length - 1];
      const client1User1AfterUpdate = client1LatestAfterUpdate.find(
        (u: any) => u.id === user1Id
      );
      expect(client1User1AfterUpdate).toBeDefined();
      expect(client1User1AfterUpdate?.name).toBe("User 1 Updated");

      unsubscribe1();
    });

    test("should pass entity data correctly for filtering", async () => {
      const user1Id = "user1";
      const user2Id = "user2";

      // Insert users via storage
      await storage.insert(testSchema.users, {
        id: user1Id,
        name: "User 1",
        email: "user1@example.com",
      });

      await storage.insert(testSchema.users, {
        id: user2Id,
        name: "User 2",
        email: "user2@example.com",
      });

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Subscribe client1 to users collection
      const client1Updates: any[] = [];
      const unsubscribe1 = client1.store.query.users.subscribe((users) => {
        client1Updates.push(users);
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update user1 via storage (should trigger notification with entity data)
      await storage.update(testSchema.users, user1Id, {
        name: "User 1 Updated",
      });

      // Wait for mutation to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Client1 should receive the update with correct entity data
      expect(client1Updates.length).toBeGreaterThan(0);
      const client1Latest = client1Updates[client1Updates.length - 1];
      const client1User1 = client1Latest.find((u: any) => u.id === user1Id);
      expect(client1User1).toBeDefined();
      expect(client1User1?.name).toBe("User 1 Updated");
      expect(client1User1?.email).toBe("user1@example.com");

      // Client1 should NOT see user2
      const client1User2 = client1Latest.find((u: any) => u.id === user2Id);
      expect(client1User2).toBeUndefined();

      unsubscribe1();
    });

    test("should handle authorization where clause with complex conditions", async () => {
      // Create router with complex authorization using email domain
      const complexAuthorizedRoute = routeFactory();
      const complexRouter = router({
        schema: testSchema,
        routes: {
          users: complexAuthorizedRoute.collectionRoute(testSchema.users, {
            read: ({ ctx }) => {
              // Allow users to see their own data OR users with specific public emails
              if (ctx.userId) {
                return {
                  $or: [
                    { id: ctx.userId },
                    {
                      email: {
                        $in: ["public@public.com", "anotherpublic@public.com"],
                      },
                    },
                  ],
                };
              }
              return {
                email: {
                  $in: ["public@public.com", "anotherpublic@public.com"],
                },
              };
            },
          }),
          posts: complexAuthorizedRoute.collectionRoute(testSchema.posts),
        },
      });

      const complexServer = server({
        router: complexRouter,
        storage,
        schema: testSchema,
        contextProvider: async ({ queryParams }) => {
          return {
            userId: queryParams["userId"],
          };
        },
      });

      const { app } = expressWs(express());
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));
      expressAdapter(app, complexServer);

      let complexHttpServer: HttpServer | null = null;
      const complexPort = await new Promise<number>((resolve) => {
        complexHttpServer = app.listen(0, () => {
          const address = complexHttpServer?.address();
          const port =
            typeof address === "object" && address?.port ? address.port : 0;
          resolve(port);
        });
      });

      const complexClient = createClient({
        url: `ws://localhost:${complexPort}/ws?userId=user1`,
        schema: testSchema,
        storage: false,
        connection: {
          autoConnect: true,
          autoReconnect: false,
        },
      });

      await complexClient.client.load(
        complexClient.store.query.users.buildQueryRequest()
      );
      await complexClient.client.load(
        complexClient.store.query.posts.buildQueryRequest()
      );
      await waitForConnection(complexClient);

      // Insert users with different email domains
      const publicUserId = generateId();
      const privateUserId = generateId();

      await storage.insert(testSchema.users, {
        id: publicUserId,
        name: "Public User",
        email: "public@public.com",
      });

      await storage.insert(testSchema.users, {
        id: privateUserId,
        name: "Private User",
        email: "private@private.com",
      });

      await storage.insert(testSchema.users, {
        id: "user1",
        name: "User 1",
        email: "user1@private.com",
      });

      // Wait for initial sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Subscribe to users collection
      const updates: any[] = [];
      const unsubscribe = complexClient.store.query.users.subscribe((users) => {
        updates.push(users);
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert another public user
      const anotherPublicUserId = generateId();
      await storage.insert(testSchema.users, {
        id: anotherPublicUserId,
        name: "Another Public User",
        email: "anotherpublic@public.com",
      });

      // Wait for mutations to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Client should see: user1 (their own), publicUserId, anotherPublicUserId
      // Client should NOT see: privateUserId
      expect(updates.length).toBeGreaterThan(0);
      const latest = updates[updates.length - 1];

      const seenUser1 = latest.find((u: any) => u.id === "user1");
      const seenPublic = latest.find((u: any) => u.id === publicUserId);
      const seenAnotherPublic = latest.find(
        (u: any) => u.id === anotherPublicUserId
      );
      const seenPrivate = latest.find((u: any) => u.id === privateUserId);

      expect(seenUser1).toBeDefined();
      expect(seenPublic).toBeDefined();
      expect(seenAnotherPublic).toBeDefined();
      expect(seenPrivate).toBeUndefined();

      unsubscribe();
      complexClient.client.ws.disconnect();

      if (complexHttpServer) {
        await new Promise<void>((resolve) => {
          complexHttpServer?.close(() => resolve());
        });
      }
    });
  });

  describe("Enum Field Tests", () => {
    // Create a schema with enum fields for testing
    const orderStatusEnum = enumType([
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ] as const);
    const priorityEnum = enumType(["low", "medium", "high"] as const);

    const order = object("orders", {
      id: id(),
      status: orderStatusEnum,
      priority: priorityEnum.nullable(),
      customerName: string(),
    });

    const orderSchema = createSchema({
      orders: order,
    });

    const orderRoute = routeFactory();
    const orderRouter = router({
      schema: orderSchema,
      routes: {
        orders: orderRoute.collectionRoute(orderSchema.orders),
      },
    });

    let orderStorage: SQLStorage;
    let orderServer: ReturnType<typeof server>;
    let orderHttpServer: HttpServer | null = null;
    let orderServerPort: number;
    let orderWsClient: ReturnType<typeof createClient<typeof orderRouter>>;
    let orderFetchClient: ReturnType<
      typeof createFetchClient<typeof orderRouter>
    >;

    beforeEach(async () => {
      orderStorage = new SQLStorage(pool);

      // Initialize storage to create tables and enum types
      await orderStorage.init(orderSchema);

      orderServer = server({
        router: orderRouter,
        storage: orderStorage,
        schema: orderSchema,
        logLevel: LogLevel.DEBUG,
      });

      // Clean up tables
      try {
        await pool.query(
          "TRUNCATE TABLE orders, orders_meta RESTART IDENTITY CASCADE"
        );
      } catch (error) {
        // Ignore errors if tables don't exist yet
      }

      const { app } = expressWs(express());
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      expressAdapter(app, orderServer);

      orderServerPort = await new Promise<number>((resolve) => {
        orderHttpServer = app.listen(0, () => {
          const address = orderHttpServer?.address();
          const port =
            typeof address === "object" && address?.port ? address.port : 0;
          resolve(port);
        });
      });

      orderWsClient = createClient({
        url: `ws://localhost:${orderServerPort}/ws`,
        schema: orderSchema,
        storage: false,
        connection: {
          autoConnect: true,
          autoReconnect: false,
        },
      });

      await orderWsClient.client.load(
        orderWsClient.store.query.orders.buildQueryRequest()
      );
      await waitForConnection(orderWsClient);

      orderFetchClient = createFetchClient({
        url: `http://localhost:${orderServerPort}`,
        schema: orderSchema,
      });
    });

    afterEach(async () => {
      if (orderWsClient?.client?.ws) {
        orderWsClient.client.ws.disconnect();
      }

      if (orderHttpServer) {
        await new Promise<void>((resolve) => {
          orderHttpServer?.close(() => resolve());
        });
        orderHttpServer = null;
      }

      if (pool) {
        try {
          await pool.query(
            "TRUNCATE TABLE orders, orders_meta RESTART IDENTITY CASCADE"
          );
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    });

    describe("Websocket Client - Enum Fields", () => {
      test("should handle empty query with enum fields", async () => {
        const result = await orderWsClient.store.query.orders.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      test("should handle query with enum field data", async () => {
        const orderId = generateId();
        await orderStorage.insert(orderSchema.orders, {
          id: orderId,
          status: "pending",
          priority: "high",
          customerName: "John Doe",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await orderWsClient.store.query.orders.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1);

        const order = result[0];
        expect(order).toBeDefined();
        expect(order.id).toBe(orderId);
        expect(order.status).toBe("pending");
        expect(order.priority).toBe("high");
        expect(order.customerName).toBe("John Doe");
      });

      test("should handle enum field with null value", async () => {
        const orderId = generateId();
        await orderStorage.insert(orderSchema.orders, {
          id: orderId,
          status: "processing",
          priority: null,
          customerName: "Jane Doe",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await orderWsClient.store.query.orders.get();

        expect(result.length).toBe(1);
        const order = result[0];
        expect(order.status).toBe("processing");
        expect(order.priority).toBeNull();
      });

      test("should handle enum field mutations (insert)", async () => {
        const orderId = generateId();

        orderWsClient.store.mutate.orders.insert({
          id: orderId,
          status: "shipped",
          priority: "medium",
          customerName: "Alice Smith",
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const result = await orderWsClient.store.query.orders.get();
        const insertedOrder = result.find((o: any) => o.id === orderId);

        expect(insertedOrder).toBeDefined();
        expect(insertedOrder?.status).toBe("shipped");
        expect(insertedOrder?.priority).toBe("medium");
        expect(insertedOrder?.customerName).toBe("Alice Smith");
      });

      test("should handle enum field mutations (update)", async () => {
        const orderId = generateId();
        await orderStorage.insert(orderSchema.orders, {
          id: orderId,
          status: "pending",
          priority: "low",
          customerName: "Bob Johnson",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        orderWsClient.store.mutate.orders.update(orderId, {
          status: "delivered",
          priority: "high",
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const result = await orderWsClient.store.query.orders.get();
        const updatedOrder = result.find((o: any) => o.id === orderId);

        expect(updatedOrder).toBeDefined();
        expect(updatedOrder?.status).toBe("delivered");
        expect(updatedOrder?.priority).toBe("high");
        expect(updatedOrder?.customerName).toBe("Bob Johnson");
      });

      test("should handle enum field with where clause", async () => {
        const orderId1 = generateId();
        const orderId2 = generateId();

        await orderStorage.insert(orderSchema.orders, {
          id: orderId1,
          status: "pending",
          priority: "high",
          customerName: "Customer 1",
        });

        await orderStorage.insert(orderSchema.orders, {
          id: orderId2,
          status: "delivered",
          priority: "low",
          customerName: "Customer 2",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await orderWsClient.store.query.orders
          .where({ status: "pending" })
          .get();

        expect(result.length).toBe(1);
        expect(result[0].id).toBe(orderId1);
        expect(result[0].status).toBe("pending");
      });

      test("should sync enum field mutations between clients", async () => {
        const client1 = createClient({
          url: `ws://localhost:${orderServerPort}/ws`,
          schema: orderSchema,
          storage: false,
          connection: {
            autoConnect: true,
            autoReconnect: false,
          },
        });

        await client1.client.load(
          client1.store.query.orders.buildQueryRequest()
        );
        await waitForConnection(client1);

        const client2 = createClient({
          url: `ws://localhost:${orderServerPort}/ws`,
          schema: orderSchema,
          storage: false,
          connection: {
            autoConnect: true,
            autoReconnect: false,
          },
        });

        await client2.client.load(
          client2.store.query.orders.buildQueryRequest()
        );
        await waitForConnection(client2);

        const orderId = generateId();
        const receivedUpdates: any[] = [];
        const unsubscribe = client2.store.query.orders.subscribe((orders) => {
          receivedUpdates.push(orders);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        client1.store.mutate.orders.insert({
          id: orderId,
          status: "processing",
          priority: "high",
          customerName: "Sync Test",
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(receivedUpdates.length).toBeGreaterThan(0);
        const latest = receivedUpdates[receivedUpdates.length - 1];
        const syncedOrder = latest.find((o: any) => o.id === orderId);

        expect(syncedOrder).toBeDefined();
        expect(syncedOrder?.status).toBe("processing");
        expect(syncedOrder?.priority).toBe("high");

        unsubscribe();
        client1.client.ws.disconnect();
        client2.client.ws.disconnect();
      });
    });

    describe("Fetch Client - Enum Fields", () => {
      test("should handle empty query with enum fields", async () => {
        const result = await orderFetchClient.query.orders.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      test("should handle query with enum field data", async () => {
        const orderId = generateId();
        await orderStorage.insert(orderSchema.orders, {
          id: orderId,
          status: "cancelled",
          priority: "low",
          customerName: "Test Customer",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await orderFetchClient.query.orders.get();

        expect(result.length).toBe(1);
        const order = result[0];
        expect(order.status).toBe("cancelled");
        expect(order.priority).toBe("low");
      });

      test("should handle enum field with where clause", async () => {
        const orderId1 = generateId();
        const orderId2 = generateId();

        await orderStorage.insert(orderSchema.orders, {
          id: orderId1,
          status: "shipped",
          priority: "medium",
          customerName: "Customer A",
        });

        await orderStorage.insert(orderSchema.orders, {
          id: orderId2,
          status: "pending",
          priority: "high",
          customerName: "Customer B",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await orderFetchClient.query.orders
          .where({ status: "shipped" })
          .get();

        expect(result.length).toBe(1);
        expect(result[0].id).toBe(orderId1);
        expect(result[0].status).toBe("shipped");
      });
    });
  });

  describe("JSON Field Tests", () => {
    // Create a schema with JSON fields for testing
    type OrderMetadata = {
      tags: string[];
      notes: string;
      customFields: Record<string, unknown>;
    };

    type UserPreferences = {
      theme: "light" | "dark";
      notifications: boolean;
      settings: {
        language: string;
        timezone: string;
      };
    };

    const product = object("products", {
      id: id(),
      name: string(),
      metadata: json<OrderMetadata>(),
      preferences: json<UserPreferences>().nullable(),
      price: number(),
    });

    const productSchema = createSchema({
      products: product,
    });

    const productRoute = routeFactory();
    const productRouter = router({
      schema: productSchema,
      routes: {
        products: productRoute.collectionRoute(productSchema.products),
      },
    });

    let productStorage: SQLStorage;
    let productServer: ReturnType<typeof server>;
    let productHttpServer: HttpServer | null = null;
    let productServerPort: number;
    let productWsClient: ReturnType<typeof createClient<typeof productRouter>>;
    let productFetchClient: ReturnType<
      typeof createFetchClient<typeof productRouter>
    >;

    beforeEach(async () => {
      productStorage = new SQLStorage(pool);

      // Initialize storage to create tables
      await productStorage.init(productSchema);

      productServer = server({
        router: productRouter,
        storage: productStorage,
        schema: productSchema,
        logLevel: LogLevel.DEBUG,
      });

      // Clean up tables
      try {
        await pool.query(
          "TRUNCATE TABLE products, products_meta RESTART IDENTITY CASCADE"
        );
      } catch (error) {
        // Ignore errors if tables don't exist yet
      }

      const { app } = expressWs(express());
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      expressAdapter(app, productServer);

      productServerPort = await new Promise<number>((resolve) => {
        productHttpServer = app.listen(0, () => {
          const address = productHttpServer?.address();
          const port =
            typeof address === "object" && address?.port ? address.port : 0;
          resolve(port);
        });
      });

      productWsClient = createClient({
        url: `ws://localhost:${productServerPort}/ws`,
        schema: productSchema,
        storage: false,
        connection: {
          autoConnect: true,
          autoReconnect: false,
        },
      });

      await productWsClient.client.load(
        productWsClient.store.query.products.buildQueryRequest()
      );
      await waitForConnection(productWsClient);

      productFetchClient = createFetchClient({
        url: `http://localhost:${productServerPort}`,
        schema: productSchema,
      });
    });

    afterEach(async () => {
      if (productWsClient?.client?.ws) {
        productWsClient.client.ws.disconnect();
      }

      if (productHttpServer) {
        await new Promise<void>((resolve) => {
          productHttpServer?.close(() => resolve());
        });
        productHttpServer = null;
      }

      if (pool) {
        try {
          await pool.query(
            "TRUNCATE TABLE products, products_meta RESTART IDENTITY CASCADE"
          );
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    });

    describe("Websocket Client - JSON Fields", () => {
      test("should handle empty query with JSON fields", async () => {
        const result = await productWsClient.store.query.products.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      test("should handle query with JSON field data", async () => {
        const productId = generateId();
        const metadata: OrderMetadata = {
          tags: ["electronics", "gadget"],
          notes: "High quality product",
          customFields: {
            warranty: "2 years",
            rating: 4.5,
          },
        };

        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Smartphone",
          metadata,
          preferences: null,
          price: 999,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await productWsClient.store.query.products.get();

        expect(result.length).toBe(1);
        const product = result[0];
        expect(product.id).toBe(productId);
        expect(product.name).toBe("Smartphone");
        expect(product.metadata).toBeDefined();
        expect(product.metadata.tags).toEqual(["electronics", "gadget"]);
        expect(product.metadata.notes).toBe("High quality product");
        expect(product.metadata.customFields.warranty).toBe("2 years");
        expect(product.metadata.customFields.rating).toBe(4.5);
        expect(product.preferences).toBeNull();
        expect(product.price).toBe(999);
      });

      test("should handle JSON field with nested objects", async () => {
        const productId = generateId();
        const preferences: UserPreferences = {
          theme: "dark",
          notifications: true,
          settings: {
            language: "en-US",
            timezone: "UTC",
          },
        };

        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Laptop",
          metadata: {
            tags: ["computers"],
            notes: "",
            customFields: {},
          },
          preferences,
          price: 1299,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await productWsClient.store.query.products.get();

        expect(result.length).toBe(1);
        const product = result[0];
        expect(product.preferences).toBeDefined();
        expect(product.preferences?.theme).toBe("dark");
        expect(product.preferences?.notifications).toBe(true);
        expect(product.preferences?.settings.language).toBe("en-US");
        expect(product.preferences?.settings.timezone).toBe("UTC");
      });

      test("should handle JSON field mutations (insert)", async () => {
        const productId = generateId();
        const metadata: OrderMetadata = {
          tags: ["new", "featured"],
          notes: "Just added",
          customFields: {
            featured: true,
          },
        };

        productWsClient.store.mutate.products.insert({
          id: productId,
          name: "New Product",
          metadata,
          preferences: null,
          price: 49,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const result = await productWsClient.store.query.products.get();
        const insertedProduct = result.find((p: any) => p.id === productId);

        expect(insertedProduct).toBeDefined();
        expect(insertedProduct?.name).toBe("New Product");
        expect(insertedProduct?.metadata.tags).toEqual(["new", "featured"]);
        expect(insertedProduct?.metadata.customFields.featured).toBe(true);
      });

      test("should handle JSON field mutations (update)", async () => {
        const productId = generateId();
        const initialMetadata: OrderMetadata = {
          tags: ["old"],
          notes: "Original",
          customFields: {},
        };

        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Product",
          metadata: initialMetadata,
          preferences: null,
          price: 100,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const updatedMetadata: OrderMetadata = {
          tags: ["updated", "modified"],
          notes: "Updated notes",
          customFields: {
            version: 2,
          },
        };

        productWsClient.store.mutate.products.update(productId, {
          metadata: updatedMetadata,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const result = await productWsClient.store.query.products.get();
        const updatedProduct = result.find((p: any) => p.id === productId);

        expect(updatedProduct).toBeDefined();
        expect(updatedProduct?.metadata.tags).toEqual(["updated", "modified"]);
        expect(updatedProduct?.metadata.notes).toBe("Updated notes");
        expect(updatedProduct?.metadata.customFields.version).toBe(2);
      });

      test("should handle JSON field with null value", async () => {
        const productId = generateId();
        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Simple Product",
          metadata: {
            tags: [],
            notes: "",
            customFields: {},
          },
          preferences: null,
          price: 50,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await productWsClient.store.query.products.get();

        expect(result.length).toBe(1);
        const product = result[0];
        expect(product.preferences).toBeNull();
      });

      test("should sync JSON field mutations between clients", async () => {
        const client1 = createClient({
          url: `ws://localhost:${productServerPort}/ws`,
          schema: productSchema,
          storage: false,
          connection: {
            autoConnect: true,
            autoReconnect: false,
          },
        });

        await client1.client.load(
          client1.store.query.products.buildQueryRequest()
        );
        await waitForConnection(client1);

        const client2 = createClient({
          url: `ws://localhost:${productServerPort}/ws`,
          schema: productSchema,
          storage: false,
          connection: {
            autoConnect: true,
            autoReconnect: false,
          },
        });

        await client2.client.load(
          client2.store.query.products.buildQueryRequest()
        );
        await waitForConnection(client2);

        const productId = generateId();
        const metadata: OrderMetadata = {
          tags: ["sync", "test"],
          notes: "Synced product",
          customFields: {
            synced: true,
            timestamp: Date.now(),
          },
        };

        const receivedUpdates: any[] = [];
        const unsubscribe = client2.store.query.products.subscribe(
          (products) => {
            receivedUpdates.push(products);
          }
        );

        await new Promise((resolve) => setTimeout(resolve, 100));

        client1.store.mutate.products.insert({
          id: productId,
          name: "Synced Product",
          metadata,
          preferences: null,
          price: 199,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(receivedUpdates.length).toBeGreaterThan(0);
        const latest = receivedUpdates[receivedUpdates.length - 1];
        const syncedProduct = latest.find((p: any) => p.id === productId);

        expect(syncedProduct).toBeDefined();
        expect(syncedProduct?.name).toBe("Synced Product");
        expect(syncedProduct?.metadata.tags).toEqual(["sync", "test"]);
        expect(syncedProduct?.metadata.customFields.synced).toBe(true);

        unsubscribe();
        client1.client.ws.disconnect();
        client2.client.ws.disconnect();
      });

      test("should handle complex nested JSON structures", async () => {
        const productId = generateId();
        const complexMetadata: OrderMetadata = {
          tags: ["complex", "nested", "structure"],
          notes: "Complex JSON test",
          customFields: {
            level1: {
              level2: {
                level3: {
                  value: "deep nested",
                  array: [1, 2, 3],
                  boolean: true,
                },
              },
            },
            array: [
              { id: 1, name: "item1" },
              { id: 2, name: "item2" },
            ],
          },
        };

        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Complex Product",
          metadata: complexMetadata,
          preferences: null,
          price: 299,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await productWsClient.store.query.products.get();

        expect(result.length).toBe(1);
        const product = result[0];
        expect(product.metadata.customFields.level1.level2.level3.value).toBe(
          "deep nested"
        );
        expect(
          product.metadata.customFields.level1.level2.level3.array
        ).toEqual([1, 2, 3]);
        expect(product.metadata.customFields.array).toHaveLength(2);
        expect(product.metadata.customFields.array[0].name).toBe("item1");
      });
    });

    describe("Fetch Client - JSON Fields", () => {
      test("should handle empty query with JSON fields", async () => {
        const result = await productFetchClient.query.products.get();

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      });

      test("should handle query with JSON field data", async () => {
        const productId = generateId();
        const metadata: OrderMetadata = {
          tags: ["fetch", "test"],
          notes: "Fetch client test",
          customFields: {
            test: true,
          },
        };

        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Fetch Product",
          metadata,
          preferences: null,
          price: 79,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await productFetchClient.query.products.get();

        expect(result.length).toBe(1);
        const product = result[0];
        expect(product.metadata.tags).toEqual(["fetch", "test"]);
        expect(product.metadata.customFields.test).toBe(true);
      });

      test("should handle JSON field with nested objects", async () => {
        const productId = generateId();
        const preferences: UserPreferences = {
          theme: "light",
          notifications: false,
          settings: {
            language: "pt-BR",
            timezone: "America/Sao_Paulo",
          },
        };

        await productStorage.insert(productSchema.products, {
          id: productId,
          name: "Localized Product",
          metadata: {
            tags: [],
            notes: "",
            customFields: {},
          },
          preferences,
          price: 89,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await productFetchClient.query.products.get();

        expect(result.length).toBe(1);
        const product = result[0];
        expect(product.preferences?.theme).toBe("light");
        expect(product.preferences?.settings.language).toBe("pt-BR");
        expect(product.preferences?.settings.timezone).toBe(
          "America/Sao_Paulo"
        );
      });
    });
  });
});
