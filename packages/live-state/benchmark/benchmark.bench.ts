/**
 * CodSpeed Benchmark Suite for live-state library
 * Uses vitest-bench for continuous performance monitoring
 */

import { bench, describe } from "vitest";
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
} from "../src/schema";
import { routeFactory, router, server, expressAdapter } from "../src/server";
import { SQLStorage } from "../src/server/storage";
import { generateId } from "../src/core/utils";
import { createClient as createFetchClient } from "../src/client/fetch";
import type { Server as HttpServer } from "http";
import { LogLevel } from "../src/utils";

/**
 * Benchmark schema: orgs -> posts -> comments -> users
 */
const org = object("orgs", {
  id: id(),
  name: string(),
});

const user = object("users", {
  id: id(),
  name: string(),
  email: string(),
});

const post = object("posts", {
  id: id(),
  title: string(),
  content: string(),
  orgId: reference("orgs.id"),
  authorId: reference("users.id"),
  likes: number(),
});

const comment = object("comments", {
  id: id(),
  content: string(),
  postId: reference("posts.id"),
  authorId: reference("users.id"),
});

const orgRelations = createRelations(org, ({ many }) => ({
  posts: many(post, "orgId"),
}));

const userRelations = createRelations(user, ({ many }) => ({
  posts: many(post, "authorId"),
  comments: many(comment, "authorId"),
}));

const postRelations = createRelations(post, ({ one, many }) => ({
  org: one(org, "orgId"),
  author: one(user, "authorId"),
  comments: many(comment, "postId"),
}));

const commentRelations = createRelations(comment, ({ one }) => ({
  post: one(post, "postId"),
  author: one(user, "authorId"),
}));

const benchmarkSchema = createSchema({
  orgs: org,
  users: user,
  posts: post,
  comments: comment,
  orgRelations,
  userRelations,
  postRelations,
  commentRelations,
});

const publicRoute = routeFactory();

const benchmarkRouter = router({
  schema: benchmarkSchema,
  routes: {
    orgs: publicRoute.collectionRoute(benchmarkSchema.orgs),
    users: publicRoute.collectionRoute(benchmarkSchema.users),
    posts: publicRoute.collectionRoute(benchmarkSchema.posts),
    comments: publicRoute.collectionRoute(benchmarkSchema.comments),
  },
});

// Global setup state
let pool: Pool;
let storage: SQLStorage;
let testServer: ReturnType<typeof server>;
let httpServer: HttpServer | null = null;
let serverPort: number = 0;
let fetchClient: ReturnType<
  typeof createFetchClient<typeof benchmarkRouter>
> | null = null;

/**
 * Setup function to initialize test infrastructure
 */
async function setupBenchmarkInfrastructure() {
  // Create database pool
  pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://admin:admin@localhost:5432/live_state_benchmark_test",
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // Create SQL storage
  storage = new SQLStorage(pool);
  await storage.init(benchmarkSchema);

  // Create server
  testServer = server({
    router: benchmarkRouter,
    storage: storage,
    schema: benchmarkSchema,
    logLevel: LogLevel.ERROR,
  });

  // Clean up all tables
  try {
    await pool.query(
      "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE",
    );
  } catch (error) {
    // Ignore errors if tables don't exist yet
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

  // Create fetch client
  fetchClient = createFetchClient({
    url: `http://localhost:${serverPort}`,
    schema: benchmarkSchema,
  });
}

/**
 * Teardown function to clean up test infrastructure
 */
async function teardownBenchmarkInfrastructure() {
  // Close HTTP server
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve());
    });
    httpServer = null;
  }

  // Clean up tables
  if (pool) {
    try {
      await pool.query(
        "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE",
      );
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  // Close pool
  if (pool) {
    await pool.end();
  }
}

/**
 * Prime the database with test data
 */
async function primeDatabase(dataSize: number) {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const postIds: string[] = [];

  // Create orgs
  for (let i = 0; i < dataSize; i++) {
    const orgId = generateId();
    orgIds.push(orgId);
    await storage.insert(benchmarkSchema.orgs, {
      id: orgId,
      name: `Organization ${i}`,
    });
  }

  // Create users
  for (let i = 0; i < dataSize; i++) {
    const userId = generateId();
    userIds.push(userId);
    await storage.insert(benchmarkSchema.users, {
      id: userId,
      name: `User ${i}`,
      email: `user${i}@example.com`,
    });
  }

  // Create posts
  for (let i = 0; i < dataSize; i++) {
    const postId = generateId();
    postIds.push(postId);
    const orgId = orgIds[i % orgIds.length];
    const authorId = userIds[i % userIds.length];

    await storage.insert(benchmarkSchema.posts, {
      id: postId,
      title: `Post ${i}`,
      content: `Content for post ${i}`,
      orgId,
      authorId,
      likes: i % 10,
    });
  }

  // Create comments
  for (let i = 0; i < dataSize; i++) {
    const commentId = generateId();
    const postId = postIds[i % postIds.length];
    const authorId = userIds[i % userIds.length];

    await storage.insert(benchmarkSchema.comments, {
      id: commentId,
      content: `Comment ${i}`,
      postId,
      authorId,
    });
  }
}

describe("live-state query benchmarks", () => {
  bench(
    "nested include query - orgs with posts, comments, and authors",
    async () => {
      await fetchClient!.query.orgs
        .include({
          posts: {
            comments: {
              author: true,
            },
            author: true,
          },
        })
        .get();
    },
    {
      setup: async () => {
        await setupBenchmarkInfrastructure();
        await primeDatabase(50); // Use 50 records for benchmarks
      },
      teardown: async () => {
        await teardownBenchmarkInfrastructure();
      },
    },
  );

  bench(
    "simple query - fetch all users",
    async () => {
      await fetchClient!.query.users.get();
    },
    {
      setup: async () => {
        await setupBenchmarkInfrastructure();
        await primeDatabase(50);
      },
      teardown: async () => {
        await teardownBenchmarkInfrastructure();
      },
    },
  );

  bench(
    "shallow include - posts with author",
    async () => {
      await fetchClient!.query.posts
        .include({
          author: true,
        })
        .get();
    },
    {
      setup: async () => {
        await setupBenchmarkInfrastructure();
        await primeDatabase(50);
      },
      teardown: async () => {
        await teardownBenchmarkInfrastructure();
      },
    },
  );
});
