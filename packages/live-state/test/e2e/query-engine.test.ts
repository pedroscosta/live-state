/**
 * End-to-end test for deep relational queries
 * Tests server.handleQuery with org -> users -> posts -> comments schema
 */

import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  test,
} from "vitest";
import { Pool } from "pg";
import {
  createRelations,
  createSchema,
  id,
  number,
  object,
  reference,
  string,
} from "../../src/schema";
import { routeFactory, router, server } from "../../src/server";
import { SQLStorage } from "../../src/server/storage";
import { generateId } from "../../src/core/utils";
import { LogLevel } from "../../src/utils";

/**
 * Deep relational schema: org -> users -> posts -> comments
 */
const org = object("orgs", {
  id: id(),
  name: string(),
});

const user = object("users", {
  id: id(),
  name: string(),
  email: string(),
  orgId: reference("orgs.id"),
});

const post = object("posts", {
  id: id(),
  title: string(),
  content: string(),
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
  users: many(user, "orgId"),
}));

const userRelations = createRelations(user, ({ one, many }) => ({
  org: one(org, "orgId"),
  posts: many(post, "authorId"),
  comments: many(comment, "authorId"),
}));

const postRelations = createRelations(post, ({ one, many }) => ({
  author: one(user, "authorId"),
  comments: many(comment, "postId"),
}));

const commentRelations = createRelations(comment, ({ one }) => ({
  post: one(post, "postId"),
  author: one(user, "authorId"),
}));

const deepSchema = createSchema({
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

const deepRouter = router({
  schema: deepSchema,
  routes: {
    orgs: publicRoute.collectionRoute(deepSchema.orgs),
    users: publicRoute.collectionRoute(deepSchema.users),
    posts: publicRoute.collectionRoute(deepSchema.posts),
    comments: publicRoute.collectionRoute(deepSchema.comments),
  },
});

describe("Deep Relational Query Tests", () => {
  let storage: SQLStorage;
  let testServer: ReturnType<typeof server>;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString:
        "postgresql://admin:admin@localhost:5432/live_state_test",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  });

  beforeEach(async () => {
    // Create SQL storage using the shared pool
    storage = new SQLStorage(pool);

    // Initialize storage before creating server
    // This ensures tables are created before the server tries to use them
    await storage.init(deepSchema);

    // Create server
    testServer = server({
      router: deepRouter,
      storage,
      schema: deepSchema,
      logLevel: LogLevel.DEBUG,
    });

    // Clean up all tables before each test
    try {
      await pool.query(
        "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE"
      );
    } catch (error) {
      // Ignore errors if tables don't exist yet (first run)
    }

    // Insert test data
    const orgId = generateId();
    const userId1 = generateId();
    const userId2 = generateId();
    const postId1 = generateId();
    const postId2 = generateId();
    const commentId1 = generateId();
    const commentId2 = generateId();
    const commentId3 = generateId();

    await storage.insert(deepSchema.orgs, {
      id: orgId,
      name: "Acme Corp",
    });

    await storage.insert(deepSchema.users, {
      id: userId1,
      name: "John Doe",
      email: "john@acme.com",
      orgId: orgId,
    });

    await storage.insert(deepSchema.users, {
      id: userId2,
      name: "Jane Smith",
      email: "jane@acme.com",
      orgId: orgId,
    });

    await storage.insert(deepSchema.posts, {
      id: postId1,
      title: "First Post",
      content: "This is the first post",
      authorId: userId1,
      likes: 10,
    });

    await storage.insert(deepSchema.posts, {
      id: postId2,
      title: "Second Post",
      content: "This is the second post",
      authorId: userId2,
      likes: 5,
    });

    await storage.insert(deepSchema.comments, {
      id: commentId1,
      content: "Great post!",
      postId: postId1,
      authorId: userId2,
    });

    await storage.insert(deepSchema.comments, {
      id: commentId2,
      content: "I agree",
      postId: postId1,
      authorId: userId1,
    });

    await storage.insert(deepSchema.comments, {
      id: commentId3,
      content: "Nice work",
      postId: postId2,
      authorId: userId1,
    });
  });

  afterEach(async () => {
    // Clean up all tables after each test
    if (pool) {
      try {
        await pool.query(
          "TRUNCATE TABLE orgs, orgs_meta, users, users_meta, posts, posts_meta, comments, comments_meta RESTART IDENTITY CASCADE"
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

  test("debug deep relational query with nested includes", async () => {
    const result = await testServer.handleQuery({
      req: {
        type: "QUERY",
        resource: "posts",
        headers: {},
        cookies: {},
        queryParams: {},
        context: {},
        // include: {
        //   author: {
        //     org: true,
        //     comments: true,
        //   },
        //   comments: {
        //     author: true,
        //   },
        // },
      },
      testNewEngine: true,
    });

    // No assertions - just for debugging
    console.log("Query result:", JSON.stringify(result, null, 2));
  });
});
