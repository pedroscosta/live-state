/**
 * End-to-end test for query engine functional requirements
 * Drives the query engine directly over an org -> users -> posts -> comments schema
 */

import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  test,
  expect,
  vi,
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
    orgs: publicRoute.withProcedures(() => ({})),
    users: publicRoute.withProcedures(() => ({})),
    posts: publicRoute.withProcedures(() => ({})),
    comments: publicRoute.withProcedures(() => ({})),
  },
});

describe("Query Engine Functional Requirements", () => {
  let storage: SQLStorage;
  let testServer: ReturnType<typeof server>;
  let pool: Pool;

  // Test data IDs
  let orgId1: string;
  let orgId2: string;
  let userId1: string;
  let userId2: string;
  let userId3: string;
  let userId4: string;
  let postId1: string;
  let postId2: string;
  let postId3: string;
  let postId4: string;
  let commentId1: string;
  let commentId2: string;
  let commentId3: string;
  let commentId4: string;
  let commentId5: string;
  let commentId6: string;

  // `Server.handleQuery` (the inbound Default Query entry point) was removed
  // with the default-query path (ADR-0002). These tests exercise the query
  // engine directly, which still exists as `server.queryEngine`. This shim
  // preserves the old `handleQuery({ req })` shape over the engine so the
  // engine's resolution/include/realtime behavior stays covered.
  const handleQuery = async (opts: {
    // biome-ignore lint/suspicious/noExplicitAny: test shim mirrors the old request shape
    req: any;
    // biome-ignore lint/suspicious/noExplicitAny: test shim mirrors the old SyncDelta callback
    subscription?: (mutation: any) => void;
  }) => {
    const {
      type: _type,
      headers = {},
      cookies = {},
      queryParams = {},
      context = {},
      ...query
    } = opts.req;
    const ctx = { headers, cookies, queryParams, context };
    const unsubscribe = opts.subscription
      ? testServer.queryEngine.subscribe(query, opts.subscription, ctx)
      : undefined;
    const data = await testServer.queryEngine.get(query, { context: ctx });
    return { data, unsubscribe };
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString:
        "postgresql://admin:admin@localhost:5432/live_state_query_engine_test",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  });

  beforeEach(async () => {
    storage = new SQLStorage(pool);
    await storage.init(deepSchema);

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

    // Setup test data: org1 (acme) with users, posts, comments
    orgId1 = generateId();
    userId1 = generateId();
    userId2 = generateId();
    postId1 = generateId();
    postId2 = generateId();
    commentId1 = generateId();
    commentId2 = generateId();
    commentId3 = generateId();

    await storage.insert(deepSchema.orgs, {
      id: orgId1,
      name: "acme",
    });

    await storage.insert(deepSchema.users, {
      id: userId1,
      name: "John Doe",
      email: "john@acme.com",
      orgId: orgId1,
    });

    await storage.insert(deepSchema.users, {
      id: userId2,
      name: "Jane Smith",
      email: "jane@acme.com",
      orgId: orgId1,
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

    // Setup test data: org2 (tech) with users, posts, comments
    orgId2 = generateId();
    userId3 = generateId();
    userId4 = generateId();
    postId3 = generateId();
    postId4 = generateId();
    commentId4 = generateId();
    commentId5 = generateId();
    commentId6 = generateId();

    await storage.insert(deepSchema.orgs, {
      id: orgId2,
      name: "tech",
    });

    await storage.insert(deepSchema.users, {
      id: userId3,
      name: "Alice Johnson",
      email: "alice@techinc.com",
      orgId: orgId2,
    });

    await storage.insert(deepSchema.users, {
      id: userId4,
      name: "Bob Williams",
      email: "bob@techinc.com",
      orgId: orgId2,
    });

    await storage.insert(deepSchema.posts, {
      id: postId3,
      title: "Tech Innovation",
      content: "Exploring new technologies",
      authorId: userId3,
      likes: 15,
    });

    await storage.insert(deepSchema.posts, {
      id: postId4,
      title: "Future of Development",
      content: "Thoughts on software development",
      authorId: userId4,
      likes: 8,
    });

    await storage.insert(deepSchema.comments, {
      id: commentId4,
      content: "Excellent insights!",
      postId: postId3,
      authorId: userId4,
    });

    await storage.insert(deepSchema.comments, {
      id: commentId5,
      content: "Very informative",
      postId: postId3,
      authorId: userId3,
    });

    await storage.insert(deepSchema.comments, {
      id: commentId6,
      content: "Looking forward to more",
      postId: postId4,
      authorId: userId3,
    });
  });

  afterEach(async () => {
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
    if (pool) {
      await pool.end();
    }
  });

  describe("Query Execution", () => {
    test("returns all resources when no filters are applied", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
      });

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(4);

      // Verify all posts have required fields
      const postIds = result.data.map((post: any) => post.value.id.value);
      expect(postIds).toContain(postId1);
      expect(postIds).toContain(postId2);
      expect(postIds).toContain(postId3);
      expect(postIds).toContain(postId4);

      result.data.forEach((post: any) => {
        expect(post.value.id).toBeDefined();
        expect(post.value.title).toBeDefined();
        expect(post.value.content).toBeDefined();
        expect(post.value.authorId).toBeDefined();
        expect(post.value.likes).toBeDefined();
      });
    });

    test("returns nested data structure when includes are specified", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            name: "acme",
          },
          include: {
            users: {
              posts: {
                comments: true,
              },
            },
          },
        },
      });

      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(1);

      const org = result.data[0];
      expect(org.value.name.value).toBe("acme");
      expect(org.value.users).toBeDefined();
      expect(org.value.users.value).toBeDefined();
      expect(Array.isArray(org.value.users.value)).toBe(true);
      expect(org.value.users.value.length).toBe(2);

      // Verify nested structure
      for (const user of org.value.users.value) {
        expect(user.value.posts).toBeDefined();
        expect(Array.isArray(user.value.posts.value)).toBe(true);

        for (const post of user.value.posts.value) {
          expect(post.value.comments).toBeDefined();
          expect(Array.isArray(post.value.comments.value)).toBe(true);
        }
      }
    });
  });

  describe("Query Filtering with Where Clauses", () => {
    test("filters results by simple field conditions", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        testNewEngine: true,
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId3);
      expect(result.data[0].value.likes.value).toBe(15);
    });

    test("filters results by relation field conditions", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              name: "John Doe",
            },
          },
        },
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);
    });

    test("filters results by nested relation field conditions", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              org: {
                name: "acme",
              },
            },
          },
        },
      });

      expect(result.data.length).toBe(2);
      const returnedPostIds = result.data.map((p: any) => p.value.id.value);
      expect(returnedPostIds).toContain(postId1);
      expect(returnedPostIds).toContain(postId2);
    });

    test("filters results with combined conditions using $and operator", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            $and: [
              {
                likes: { $gte: 5 },
              },
              {
                author: {
                  name: "John Doe",
                },
              },
            ],
          },
        },
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);
      expect(result.data[0].value.likes.value).toBe(10);
    });

    test("filters results with $in operator", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            title: { $in: ["First Post", "Second Post", "Non-existent"] },
          },
        },
      });

      expect(result.data.length).toBe(2);
      const returnedTitles = result.data.map((p: any) => p.value.title.value);
      expect(returnedTitles).toContain("First Post");
      expect(returnedTitles).toContain("Second Post");
    });
  });

  describe("INSERT Mutation Subscriptions", () => {
    test("notifies subscribers when matching object is inserted", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify initial query returns existing posts
      expect(result.data.length).toBe(4);

      // Insert a new post
      const newPostId = generateId();
      const newPostTitle = "New Post";
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      const userId = existingUsers[0].value.id.value;

      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: newPostTitle,
        content: "This is a new post",
        authorId: userId,
        likes: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify notification received
      expect(mutations.length).toBe(1);
      expect(mutations[0].resource).toBe("posts");
      expect(mutations[0].resourceId).toBe(newPostId);
      expect(mutations[0].op).toBe("INSERT");
      expect(mutations[0].payload.title.value).toBe(newPostTitle);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers only when inserted object matches where clause", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify initial query returns only matching posts
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.likes.value).toBeGreaterThan(10);

      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      const userId = existingUsers[0].value.id.value;

      // Insert matching post
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "High Likes Post",
        content: "This post has many likes",
        authorId: userId,
        likes: 15,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(1);
      expect(mutations[0].resourceId).toBe(matchingPostId);
      expect(mutations[0].payload.likes.value).toBe(15);

      // Insert non-matching post
      const nonMatchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: nonMatchingPostId,
        title: "Low Likes Post",
        content: "This post has few likes",
        authorId: userId,
        likes: 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not receive notification for non-matching post
      expect(mutations.length).toBe(1);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when inserted object matches relation-based where clause", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              org: {
                name: "acme",
              },
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify initial query returns posts by authors from acme org
      expect(result.data.length).toBe(2);

      // Get a user from acme org
      const acmeUsers = await storage.get({
        resource: "users",
        where: { orgId: orgId1 },
        limit: 1,
      });
      const acmeUserId = acmeUsers[0].value.id.value;

      // Insert post by acme user (matches)
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "Post by Acme User",
        content: "This post matches",
        authorId: acmeUserId,
        likes: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(1);
      expect(mutations[0].resourceId).toBe(matchingPostId);
      expect(mutations[0].payload.authorId.value).toBe(acmeUserId);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });

  describe("UPDATE Mutation Subscriptions", () => {
    test("notifies subscribers when tracked object is updated", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      expect(result.data.length).toBe(4);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update a tracked post
      const updatedTitle = "Updated Title";
      const updatedLikes = 20;
      await storage.update(deepSchema.posts, postId1, {
        title: updatedTitle,
        likes: updatedLikes,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(1);
      expect(mutations[0].op).toBe("UPDATE");
      expect(mutations[0].resourceId).toBe(postId1);
      expect(mutations[0].payload.title.value).toBe(updatedTitle);
      expect(mutations[0].payload.likes.value).toBe(updatedLikes);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when object transitions from non-matching to matching", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify postId2 is not in initial results (likes = 5)
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId2
      );
      expect(initialResults.length).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update post to match query
      await storage.update(deepSchema.posts, postId2, {
        likes: 15,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive INSERT mutation (object now matches)
      expect(mutations.length).toBe(1);
      expect(mutations[0].op).toBe("INSERT");
      expect(mutations[0].resourceId).toBe(postId2);
      expect(mutations[0].payload.likes.value).toBe(15);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when object transitions from matching to non-matching", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify postId3 is in initial results (likes = 15)
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId3
      );
      expect(initialResults.length).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update post to not match query
      await storage.update(deepSchema.posts, postId3, {
        likes: 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive UPDATE mutation (object no longer matches)
      expect(mutations.length).toBe(1);
      expect(mutations[0].op).toBe("UPDATE");
      expect(mutations[0].resourceId).toBe(postId3);
      expect(mutations[0].payload.likes.value).toBe(5);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("handles object transitioning between matching and non-matching states", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify postId3 is initially matching
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId3
      );
      expect(initialResults.length).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Transition 1: Matching -> Non-matching
      await storage.update(deepSchema.posts, postId3, {
        likes: 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(1);
      expect(mutations[0].op).toBe("UPDATE");
      expect(mutations[0].payload.likes.value).toBe(5);

      // Transition 2: Non-matching -> Matching
      await storage.update(deepSchema.posts, postId3, {
        likes: 15,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(2);
      expect(mutations[1].op).toBe("INSERT");
      expect(mutations[1].payload.likes.value).toBe(15);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when relation-based filter is affected by author change", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              name: "John Doe",
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify initial query returns postId1 (by John Doe)
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Change post author to Jane Smith (no longer matches)
      await storage.update(deepSchema.posts, postId1, {
        authorId: userId2,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(1);
      expect(mutations[0].op).toBe("UPDATE");
      expect(mutations[0].payload.authorId.value).toBe(userId2);

      // Change post author back to John Doe (matches again)
      await storage.update(deepSchema.posts, postId1, {
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(2);
      expect(mutations[1].op).toBe("INSERT");
      expect(mutations[1].payload.authorId.value).toBe(userId1);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("handles multiple subscriptions with different filters correctly", async () => {
      const query1Mutations: any[] = [];
      const query2Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          query1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 20 },
          },
        },
        subscription: (mutation) => {
          query2Mutations.push(mutation);
        },
      });

      expect(result1.data.length).toBe(1);
      expect(result2.data.length).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update postId3 to likes = 15 (matches query1, not query2)
      await storage.update(deepSchema.posts, postId3, {
        likes: 15,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(query1Mutations.length).toBe(1);
      expect(query1Mutations[0].op).toBe("UPDATE");
      expect(query2Mutations.length).toBe(0);

      // Update postId3 to likes = 25 (matches both)
      await storage.update(deepSchema.posts, postId3, {
        likes: 25,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(query1Mutations.length).toBe(2);
      expect(query1Mutations[1].op).toBe("UPDATE");
      expect(query2Mutations.length).toBe(1);
      expect(query2Mutations[0].op).toBe("INSERT");

      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }
    });
  });

  describe("Query Includes and Related Mutations", () => {
    test("notifies subscribers when included relation object is created", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          include: {
            comments: true,
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      expect(result.data.length).toBe(4);

      // Verify postId1 has comments included
      const post1 = result.data.find((p: any) => p.value.id.value === postId1);
      expect(post1).toBeDefined();
      expect(post1!.value.comments.value.length).toBe(2);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a new comment on postId1
      const newCommentId = generateId();
      await storage.insert(deepSchema.comments, {
        id: newCommentId,
        content: "New comment",
        postId: postId1,
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive notification for the comment
      expect(mutations.length).toBe(1);
      expect(mutations[0].resource).toBe("comments");
      expect(mutations[0].resourceId).toBe(newCommentId);
      expect(mutations[0].op).toBe("INSERT");

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when included relation object is updated", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          include: {
            author: true,
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      expect(result.data.length).toBe(4);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the author
      await storage.update(deepSchema.users, userId1, {
        name: "John Updated",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive notification for the author update
      expect(mutations.length).toBe(1);
      expect(mutations[0].resource).toBe("users");
      expect(mutations[0].resourceId).toBe(userId1);
      expect(mutations[0].op).toBe("UPDATE");

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when deeply nested included relation is updated", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {
            org: "acme",
          },
          include: {
            author: {
              org: true,
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      expect(result.data.length).toBe(4);

      // Verify nested structure
      const post1 = result.data.find((p: any) => p.value.id.value === postId1);
      expect(post1!.value.author.value.org.value.id.value).toBe(orgId1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the nested org
      await storage.update(deepSchema.orgs, orgId1, {
        name: "Acme Corp Updated",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive notification for the org update
      expect(mutations.length).toBeGreaterThan(0);
      const orgMutation = mutations.find(
        (m) => m.resource === "orgs" && m.resourceId === orgId1
      );
      expect(orgMutation).toBeDefined();
      expect(orgMutation!.op).toBe("UPDATE");

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });

  describe("Objects Moving In and Out of Query Scope", () => {
    test("notifies subscribers when object moves into scope via relation change", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            name: "acme",
          },
          include: {
            users: {
              posts: true,
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify initial query returns acme org
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.name.value).toBe("acme");

      // Verify postId3 is NOT included (it's by userId3 from tech org)
      const user1 = result.data[0].value.users.value.find(
        (u: any) => u.value.id.value === userId1
      );
      const post3InResults = user1?.value.posts.value.find(
        (p: any) => p.value.id.value === postId3
      );
      expect(post3InResults).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Move postId3 into acme scope by changing its author
      await storage.update(deepSchema.posts, postId3, {
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive INSERT mutation for the post
      const postMutation = mutations.find(
        (m) => m.resource === "posts" && m.resourceId === postId3
      );
      expect(postMutation).toBeDefined();
      expect(postMutation!.op).toBe("INSERT");
      expect(postMutation!.payload.authorId.value).toBe(userId1);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when object moves out of scope via relation change", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            name: "acme",
          },
          include: {
            users: {
              posts: true,
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify postId1 is included (by userId1 from acme org)
      const user1 = result.data[0].value.users.value.find(
        (u: any) => u.value.id.value === userId1
      );
      const post1InResults = user1?.value.posts.value.find(
        (p: any) => p.value.id.value === postId1
      );
      expect(post1InResults).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Move postId1 out of acme scope by changing its author to tech user
      await storage.update(deepSchema.posts, postId1, {
        authorId: userId3,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive UPDATE mutation for the post
      const postMutation = mutations.find(
        (m) => m.resource === "posts" && m.resourceId === postId1
      );
      expect(postMutation).toBeDefined();
      expect(postMutation!.op).toBe("UPDATE");
      expect(postMutation!.payload.authorId.value).toBe(userId3);

      // Verify subsequent updates to out-of-scope object don't trigger notifications
      const callbackCount = mutations.length;
      await storage.update(deepSchema.posts, postId1, {
        title: "Updated Title After Out of Scope",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(callbackCount);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("sends INSERT mutations for entire tree when object moves into scope", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            name: "acme",
          },
          include: {
            users: {
              posts: {
                comments: true,
              },
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      expect(result.data.length).toBe(1);

      // Get postId3's comments before moving it
      const post3Data = await storage.get({
        resource: "posts",
        where: { id: postId3 },
        include: {
          comments: true,
        },
        limit: 1,
      });
      const post3Comments = post3Data[0].value.comments?.value || [];
      const post3CommentIds = post3Comments.map((c: any) => c.value.id.value);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Move postId3 into acme scope
      await storage.update(deepSchema.posts, postId3, {
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive INSERT for the post
      const postMutation = mutations.find(
        (m) => m.resource === "posts" && m.resourceId === postId3
      );
      expect(postMutation).toBeDefined();
      expect(postMutation!.op).toBe("INSERT");

      // Should receive INSERTs for all comments on the post
      for (const commentId of post3CommentIds) {
        const commentMutation = mutations.find(
          (m) => m.resource === "comments" && m.resourceId === commentId
        );
        expect(commentMutation).toBeDefined();
        expect(commentMutation!.op).toBe("INSERT");
        expect(commentMutation!.payload.postId.value).toBe(postId3);
      }

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("handles nested relation changes affecting query scope", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            name: "acme",
          },
          include: {
            users: {
              posts: {
                comments: true,
              },
            },
          },
        },
        subscription: (mutation) => {
          mutations.push(mutation);
        },
      });

      // Verify commentId1 is included in postId1
      const user1 = result.data[0].value.users.value.find(
        (u: any) => u.value.id.value === userId1
      );
      const post1 = user1?.value.posts.value.find(
        (p: any) => p.value.id.value === postId1
      );
      const comment1InResults = post1?.value.comments.value.find(
        (c: any) => c.value.id.value === commentId1
      );
      expect(comment1InResults).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Move commentId1 out of scope by changing its postId to postId4 (from tech org)
      await storage.update(deepSchema.comments, commentId1, {
        postId: postId4,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should receive UPDATE mutation for the comment
      const commentMutation = mutations.find(
        (m) => m.resource === "comments" && m.resourceId === commentId1
      );
      expect(commentMutation).toBeDefined();
      expect(commentMutation!.op).toBe("UPDATE");
      expect(commentMutation!.payload.postId.value).toBe(postId4);

      // Verify subsequent updates to out-of-scope comment don't trigger notifications
      const callbackCount = mutations.length;
      await storage.update(deepSchema.comments, commentId1, {
        content: "Updated content after out of scope",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(callbackCount);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });

  describe("Multiple Clients and Unsubscribing", () => {
    test("multiple clients receive notifications for shallow query", async () => {
      const client1Mutations: any[] = [];
      const client2Mutations: any[] = [];
      const client3Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          client1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          client2Mutations.push(mutation);
        },
      });

      const result3 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          client3Mutations.push(mutation);
        },
      });

      // Verify all clients receive initial data
      expect(result1.data.length).toBe(4);
      expect(result2.data.length).toBe(4);
      expect(result3.data.length).toBe(4);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert a new post
      const newPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: "Shared Post",
        content: "This post should be seen by all clients",
        authorId: userId1,
        likes: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // All clients should receive the notification
      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(1);
      expect(client3Mutations.length).toBe(1);

      expect(client1Mutations[0].resourceId).toBe(newPostId);
      expect(client2Mutations[0].resourceId).toBe(newPostId);
      expect(client3Mutations[0].resourceId).toBe(newPostId);

      // Update the post
      await storage.update(deepSchema.posts, newPostId, {
        likes: 10,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // All clients should receive the update
      expect(client1Mutations.length).toBe(2);
      expect(client2Mutations.length).toBe(2);
      expect(client3Mutations.length).toBe(2);

      expect(client1Mutations[1].op).toBe("UPDATE");
      expect(client2Mutations[1].op).toBe("UPDATE");
      expect(client3Mutations[1].op).toBe("UPDATE");

      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }
      if (result3.unsubscribe) {
        result3.unsubscribe();
      }
    });

    test("multiple clients receive notifications for deep query with includes", async () => {
      const client1Mutations: any[] = [];
      const client2Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {
            org: "acme",
          },
          include: {
            author: {
              org: true,
            },
            comments: true,
          },
        },
        subscription: (mutation) => {
          client1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {
            org: "acme",
          },
          include: {
            author: {
              org: true,
            },
            comments: true,
          },
        },
        subscription: (mutation) => {
          client2Mutations.push(mutation);
        },
      });

      // Verify both clients receive initial data with nested structure
      expect(result1.data.length).toBe(4);
      expect(result2.data.length).toBe(4);

      const post1Client1 = result1.data.find(
        (p: any) => p.value.id.value === postId1
      );
      const post1Client2 = result2.data.find(
        (p: any) => p.value.id.value === postId1
      );

      expect(post1Client1!.value.author.value.org.value).toBeDefined();
      expect(post1Client2!.value.author.value.org.value).toBeDefined();
      expect(post1Client1!.value.comments.value).toBeDefined();
      expect(post1Client2!.value.comments.value).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a new comment on postId1
      const newCommentId = generateId();
      await storage.insert(deepSchema.comments, {
        id: newCommentId,
        content: "New comment from multiple clients test",
        postId: postId1,
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Both clients should receive the comment notification
      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(1);

      expect(client1Mutations[0].resource).toBe("comments");
      expect(client2Mutations[0].resource).toBe("comments");
      expect(client1Mutations[0].resourceId).toBe(newCommentId);
      expect(client2Mutations[0].resourceId).toBe(newCommentId);

      // Update the author (included relation)
      await storage.update(deepSchema.users, userId1, {
        name: "John Updated Name",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Both clients should receive the author update
      expect(client1Mutations.length).toBe(2);
      expect(client2Mutations.length).toBe(2);

      const authorUpdate1 = client1Mutations.find(
        (m) => m.resource === "users" && m.resourceId === userId1
      );
      const authorUpdate2 = client2Mutations.find(
        (m) => m.resource === "users" && m.resourceId === userId1
      );

      expect(authorUpdate1).toBeDefined();
      expect(authorUpdate2).toBeDefined();
      expect(authorUpdate1!.op).toBe("UPDATE");
      expect(authorUpdate2!.op).toBe("UPDATE");

      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }
    });

    test("unsubscribed client stops receiving notifications while others continue", async () => {
      const client1Mutations: any[] = [];
      const client2Mutations: any[] = [];
      const client3Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          client1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          client2Mutations.push(mutation);
        },
      });

      const result3 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        subscription: (mutation) => {
          client3Mutations.push(mutation);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert first post - all clients should receive it
      const post1Id = generateId();
      await storage.insert(deepSchema.posts, {
        id: post1Id,
        title: "Post Before Unsubscribe",
        content: "All clients should see this",
        authorId: userId1,
        likes: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(1);
      expect(client3Mutations.length).toBe(1);

      // Unsubscribe client2
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert second post - only client1 and client3 should receive it
      const post2Id = generateId();
      await storage.insert(deepSchema.posts, {
        id: post2Id,
        title: "Post After Unsubscribe",
        content: "Only active clients should see this",
        authorId: userId1,
        likes: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // client1 and client3 should receive the new post
      expect(client1Mutations.length).toBe(2);
      expect(client3Mutations.length).toBe(2);

      // client2 should NOT receive the new post (unsubscribed)
      expect(client2Mutations.length).toBe(1);

      expect(client1Mutations[1].resourceId).toBe(post2Id);
      expect(client3Mutations[1].resourceId).toBe(post2Id);

      // Update post1 - only client1 and client3 should receive it
      await storage.update(deepSchema.posts, post1Id, {
        likes: 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // client1 and client3 should receive the update
      expect(client1Mutations.length).toBe(3);
      expect(client3Mutations.length).toBe(3);

      // client2 should still have only 1 mutation
      expect(client2Mutations.length).toBe(1);

      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
      if (result3.unsubscribe) {
        result3.unsubscribe();
      }
    });

    test("unsubscribed client stops receiving notifications for deep query", async () => {
      const client1Mutations: any[] = [];
      const client2Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          include: {
            author: true,
            comments: true,
          },
        },
        subscription: (mutation) => {
          client1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          include: {
            author: true,
            comments: true,
          },
        },
        subscription: (mutation) => {
          client2Mutations.push(mutation);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a comment - both clients should receive it
      const comment1Id = generateId();
      await storage.insert(deepSchema.comments, {
        id: comment1Id,
        content: "Comment before unsubscribe",
        postId: postId1,
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(1);

      // Unsubscribe client2
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create another comment - only client1 should receive it
      const comment2Id = generateId();
      await storage.insert(deepSchema.comments, {
        id: comment2Id,
        content: "Comment after unsubscribe",
        postId: postId1,
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(2);
      expect(client2Mutations.length).toBe(1);

      // Update author - only client1 should receive it
      await storage.update(deepSchema.users, userId1, {
        name: "Updated After Unsubscribe",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBeGreaterThan(2);
      expect(client2Mutations.length).toBe(1);

      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
    });

    test("multiple clients with same filtered query receive notifications independently", async () => {
      const client1Mutations: any[] = [];
      const client2Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          client1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 10 },
          },
        },
        subscription: (mutation) => {
          client2Mutations.push(mutation);
        },
      });

      // Both clients should receive initial matching data
      expect(result1.data.length).toBe(1);
      expect(result2.data.length).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update postId3 to match filter - both should receive it
      await storage.update(deepSchema.posts, postId3, {
        likes: 20,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(1);

      // Unsubscribe client1
      if (result1.unsubscribe) {
        result1.unsubscribe();
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update postId3 again - only client2 should receive it
      await storage.update(deepSchema.posts, postId3, {
        likes: 25,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(2);

      if (result2.unsubscribe) {
        result2.unsubscribe();
      }
    });

    test("unsubscribing one client does not affect others with same deep query", async () => {
      const client1Mutations: any[] = [];
      const client2Mutations: any[] = [];
      const client3Mutations: any[] = [];

      const result1 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {
            org: "acme",
          },
          include: {
            users: {
              posts: {
                comments: true,
              },
            },
          },
        },
        subscription: (mutation) => {
          client1Mutations.push(mutation);
        },
      });

      const result2 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {
            org: "acme",
          },
          include: {
            users: {
              posts: {
                comments: true,
              },
            },
          },
        },
        subscription: (mutation) => {
          client2Mutations.push(mutation);
        },
      });

      const result3 = await handleQuery({
        req: {
          type: "QUERY",
          resource: "orgs",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {
            org: "acme",
          },
          include: {
            users: {
              posts: {
                comments: true,
              },
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          client3Mutations.push(mutation);
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a comment on postId1 - all clients should receive it
      const comment1Id = generateId();
      await storage.insert(deepSchema.comments, {
        id: comment1Id,
        content: "Comment before unsubscribe",
        postId: postId1,
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(1);
      expect(client2Mutations.length).toBe(1);
      expect(client3Mutations.length).toBe(1);

      // Unsubscribe client2
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create another comment - only client1 and client3 should receive it
      const comment2Id = generateId();
      await storage.insert(deepSchema.comments, {
        id: comment2Id,
        content: "Comment after unsubscribe",
        postId: postId1,
        authorId: userId2,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client1Mutations.length).toBe(2);
      expect(client2Mutations.length).toBe(1);
      expect(client3Mutations.length).toBe(2);

      // Update nested org - only client1 and client3 should receive it
      await storage.update(deepSchema.orgs, orgId1, {
        name: "Acme Updated",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const orgUpdate1 = client1Mutations.find(
        (m) => m.resource === "orgs" && m.resourceId === orgId1
      );
      const orgUpdate2 = client2Mutations.find(
        (m) => m.resource === "orgs" && m.resourceId === orgId1
      );
      const orgUpdate3 = client3Mutations.find(
        (m) => m.resource === "orgs" && m.resourceId === orgId1
      );

      expect(orgUpdate1).toBeDefined();
      expect(orgUpdate2).toBeUndefined();
      expect(orgUpdate3).toBeDefined();

      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
      if (result3.unsubscribe) {
        result3.unsubscribe();
      }
    });
  });

  // Root windowed Tracked Queries (a `limit`, ordered by own columns): membership
  // is relative, so scope changes (eviction, backfill) fire for rows that were
  // never themselves mutated. See ADR-0003 / issue #185.
  //
  // Seed posts ordered by likes desc: post3 (15), post1 (10), post4 (8), post2 (5).
  describe("Root Windowed Queries", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

    test("emits INSERT + eviction DELETE when a new row enters a full window", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "likes", direction: "desc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      // Window starts as the top-2 by likes: post3 (15), post1 (10).
      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId1,
      ]);

      // A new row that outranks the window enters at the top and displaces the
      // boundary (post1). Eviction must not touch the database.
      const getSpy = vi.spyOn(storage, "get");

      const newPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: "Chart Topper",
        content: "Most liked",
        authorId: userId1,
        likes: 20,
      });

      await settle();

      const insert = mutations.find((m) => m.resourceId === newPostId);
      expect(insert?.op).toBe("INSERT");
      expect(insert?.payload.likes.value).toBe(20);

      const evict = mutations.find((m) => m.resourceId === postId1);
      expect(evict?.op).toBe("DELETE");
      // A scope-out carries only the id (empty payload).
      expect(evict?.payload).toEqual({});

      // Eviction is resolved from in-memory window state: no boundary read.
      expect(getSpy).not.toHaveBeenCalled();
      getSpy.mockRestore();

      result.unsubscribe?.();
    });

    test("emits DELETE + backfill INSERT via one boundary read when a visible row leaves scope", async () => {
      const mutations: any[] = [];

      // where + limit so a visible row can leave scope by predicate. Matching by
      // likes desc: post3 (15), post1 (10), post4 (8); window = [post3, post1].
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          where: { likes: { $gte: 8 } },
          sort: [{ key: "likes", direction: "desc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId1,
      ]);

      const getSpy = vi.spyOn(storage, "get");

      // Drop post1 below the where threshold: it leaves scope and post4 (the next
      // row past the boundary) backfills the freed slot.
      await storage.update(deepSchema.posts, postId1, { likes: 1 });

      await settle();

      const del = mutations.find(
        (m) => m.resourceId === postId1 && m.op === "DELETE"
      );
      expect(del).toBeDefined();
      expect(del.payload).toEqual({});

      const backfill = mutations.find(
        (m) => m.resourceId === postId4 && m.op === "INSERT"
      );
      expect(backfill).toBeDefined();
      expect(backfill.payload.likes.value).toBe(8);

      // Exactly one boundary cursor read, bounded to the rows needed.
      const backfillReads = getSpy.mock.calls.filter(
        ([q]: any[]) => q.resource === "posts" && q.limit === 1
      );
      expect(backfillReads.length).toBe(1);
      getSpy.mockRestore();

      result.unsubscribe?.();
    });

    test("emits a plain UPDATE (no DELETE/INSERT) when a row stays in the window", async () => {
      const mutations: any[] = [];

      // Window = top-3 by likes: post3 (15), post1 (10), post4 (8).
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "likes", direction: "desc" }],
          limit: 3,
        },
        subscription: (m) => mutations.push(m),
      });

      const getSpy = vi.spyOn(storage, "get");

      // A field change on a windowed row that keeps it in the window: plain UPDATE.
      await storage.update(deepSchema.posts, postId1, {
        title: "First Post (edited)",
      });

      await settle();

      // Reordering the row within the window (still top-3): the field UPDATE is
      // broadcast, but no membership DELETE/INSERT and no reorder message.
      await storage.update(deepSchema.posts, postId1, { likes: 9 });

      await settle();

      const post1Deltas = mutations.filter((m) => m.resourceId === postId1);
      expect(post1Deltas.length).toBeGreaterThan(0);
      expect(post1Deltas.every((m) => m.op === "UPDATE")).toBe(true);
      expect(mutations.some((m) => m.op === "DELETE")).toBe(false);
      expect(mutations.some((m) => m.op === "INSERT")).toBe(false);

      // Within-window reorder needs no database read.
      expect(getSpy).not.toHaveBeenCalled();
      getSpy.mockRestore();

      result.unsubscribe?.();
    });

    test("brings a row into scope via UPDATE (scope-in INSERT + eviction)", async () => {
      const mutations: any[] = [];

      // Window = top-2 by likes: post3 (15), post1 (10).
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "likes", direction: "desc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      // Promote post2 (5 -> 30) above the window: it scopes in and evicts post1.
      await storage.update(deepSchema.posts, postId2, { likes: 30 });

      await settle();

      const scopeIn = mutations.find(
        (m) => m.resourceId === postId2 && m.op === "INSERT"
      );
      expect(scopeIn).toBeDefined();
      // Scope-in via update carries the full object payload, not a partial patch.
      expect(scopeIn.payload.title.value).toBe("Second Post");
      expect(scopeIn.payload.likes.value).toBe(30);

      const evict = mutations.find(
        (m) => m.resourceId === postId1 && m.op === "DELETE"
      );
      expect(evict).toBeDefined();

      result.unsubscribe?.();
    });

    test("evicts + backfills when a visible row's own sort key drops it past the boundary", async () => {
      const mutations: any[] = [];

      // Window = top-2 by likes: post3 (15), post1 (10). Untracked: post4 (8).
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "likes", direction: "desc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId1,
      ]);

      const getSpy = vi.spyOn(storage, "get");

      // post1 still matches the predicate but its likes fall below the untracked
      // post4 (8): likes desc becomes post3 (15), post4 (7... post1), so post1
      // leaves the top-2 and post4 must be pulled in.
      await storage.update(deepSchema.posts, postId1, { likes: 7 });

      await settle();

      // Membership change, not a plain UPDATE: post1 is evicted, post4 backfilled.
      const del = mutations.find(
        (m) => m.resourceId === postId1 && m.op === "DELETE"
      );
      expect(del).toBeDefined();
      expect(del.payload).toEqual({});

      const backfill = mutations.find(
        (m) => m.resourceId === postId4 && m.op === "INSERT"
      );
      expect(backfill).toBeDefined();
      expect(backfill.payload.likes.value).toBe(8);

      // post1 must not be broadcast as an in-window UPDATE.
      expect(
        mutations.some((m) => m.resourceId === postId1 && m.op === "UPDATE")
      ).toBe(false);

      // Exactly one boundary read resolves the demotion.
      const boundaryReads = getSpy.mock.calls.filter(
        (c: any) => c[0]?.limit !== undefined
      );
      expect(boundaryReads.length).toBe(1);
      getSpy.mockRestore();

      result.unsubscribe?.();
    });
  });

  // Relational orderBy: a windowed root query ordered by a *related* object's
  // field (`author.name`). A write to the related object (an author rename)
  // re-orders the window via reverse-ref fan-out plus a boundary cursor read for
  // rows that were outside the window. See ADR-0003 / issue #187.
  //
  // Authors + their single post, ordered by author.name asc:
  //   Alice Johnson  (userId3) -> postId3
  //   Bob Williams   (userId4) -> postId4
  //   Jane Smith     (userId2) -> postId2
  //   John Doe       (userId1) -> postId1
  // Window (limit 2) = [postId3 (Alice), postId4 (Bob)].
  describe("Relational orderBy (sort key from a related object)", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

    test("seeds the window in related-field order", async () => {
      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "author.name", direction: "asc" }],
          limit: 2,
        },
      });

      // Top-2 by author.name asc: Alice's post, then Bob's.
      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId4,
      ]);

      // The engine-added `author` relation is stripped from the returned rows.
      expect(result.data[0].value.author).toBeUndefined();

      result.unsubscribe?.();
    });

    test("author rename demotes an in-window row (DELETE) and pulls an unseen row in (INSERT)", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "author.name", direction: "asc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId4,
      ]);

      // Rename Alice -> "Zoe Zephyr": order becomes Bob, Jane, John, Zoe, so
      // Alice's post (postId3) leaves the top-2 and Jane's post (postId2) — never
      // loaded, invisible to the graph — must be promoted via a boundary read.
      await storage.update(deepSchema.users, userId3, { name: "Zoe Zephyr" });

      await settle();

      const del = mutations.find(
        (m) => m.resourceId === postId3 && m.op === "DELETE"
      );
      expect(del).toBeDefined();
      // A scope-out carries only the id.
      expect(del.payload).toEqual({});

      const promoted = mutations.find(
        (m) => m.resourceId === postId2 && m.op === "INSERT"
      );
      expect(promoted).toBeDefined();
      // The backfilled INSERT carries the row's own columns, not the related
      // author the engine included only to order the boundary read.
      expect(promoted.payload.author).toBeUndefined();
      expect(promoted.payload.title.value).toBe("Second Post");

      // The demoted row must not be broadcast as an in-window UPDATE.
      expect(
        mutations.some((m) => m.resourceId === postId3 && m.op === "UPDATE")
      ).toBe(false);

      result.unsubscribe?.();
    });

    test("renaming an out-of-window author promotes its unseen row (INSERT) and evicts the boundary (DELETE)", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "author.name", direction: "asc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId4,
      ]);

      // Rename John Doe (userId1 -> postId1, currently last and *outside* the
      // window) to "Aaron Aaronson". Order becomes Aaron, Alice, Bob, Jane, so
      // postId1 must enter the top-2 and Bob's postId4 is evicted. No in-window
      // row's author changed, so the reverse-ref fan-out sees nothing: only the
      // boundary read can discover this previously-unseen promotion (#187).
      await storage.update(deepSchema.users, userId1, {
        name: "Aaron Aaronson",
      });

      await settle();

      const promoted = mutations.find(
        (m) => m.resourceId === postId1 && m.op === "INSERT"
      );
      expect(promoted).toBeDefined();
      expect(promoted.payload.author).toBeUndefined();
      expect(promoted.payload.title.value).toBe("First Post");

      const evicted = mutations.find(
        (m) => m.resourceId === postId4 && m.op === "DELETE"
      );
      expect(evicted).toBeDefined();
      expect(evicted.payload).toEqual({});

      // Alice's post stayed in the window and was not re-broadcast.
      expect(
        mutations.some((m) => m.resourceId === postId3)
      ).toBe(false);

      result.unsubscribe?.();
    });

    test("author rename that only reorders within the window emits no delta", async () => {
      const mutations: any[] = [];

      const result = await handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          sort: [{ key: "author.name", direction: "asc" }],
          limit: 2,
        },
        subscription: (m) => mutations.push(m),
      });

      expect(result.data.map((p: any) => p.value.id.value)).toEqual([
        postId3,
        postId4,
      ]);

      // Rename Alice -> "Boris": the window is still {postId3, postId4} but their
      // order flips (Bob before Boris). Membership is unchanged, so nothing is
      // broadcast — the client re-sorts the rows it already holds.
      await storage.update(deepSchema.users, userId3, { name: "Boris" });

      await settle();

      expect(mutations.some((m) => m.op === "INSERT")).toBe(false);
      expect(mutations.some((m) => m.op === "DELETE")).toBe(false);

      result.unsubscribe?.();
    });
  });

  // Relational orderBy inside a *windowed include*: each post keeps a top-N
  // window of its comments ordered by a grandchild relation (the comment's
  // author name). A rename of a comment author must reorder that post's comment
  // window via the same reverse-ref fan-out + boundary read as the root case,
  // and the initial seed must select the correct per-parent top-N (which needs
  // storage to resolve the relational include orderBy). See #195 / ADR-0003.
  describe("Relational orderBy in a windowed include (grandchild sort key)", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

    // A dedicated post whose comments are authored by three fresh users, so the
    // window is independent of the base-seed data.
    let post: string;
    let authorA: string; // "Alice" -> commentA
    let authorB: string; // "Bob"   -> commentB
    let authorC: string; // "Carol" -> commentC (outside a top-2 window)
    let commentA: string;
    let commentB: string;
    let commentC: string;

    const setup = async () => {
      post = generateId();
      authorA = generateId();
      authorB = generateId();
      authorC = generateId();
      commentA = generateId();
      commentB = generateId();
      commentC = generateId();

      await storage.insert(deepSchema.users, {
        id: authorA,
        name: "Alice",
        email: "alice@x.com",
        orgId: orgId1,
      });
      await storage.insert(deepSchema.users, {
        id: authorB,
        name: "Bob",
        email: "bob@x.com",
        orgId: orgId1,
      });
      await storage.insert(deepSchema.users, {
        id: authorC,
        name: "Carol",
        email: "carol@x.com",
        orgId: orgId1,
      });
      await storage.insert(deepSchema.posts, {
        id: post,
        title: "Windowed comments",
        content: "…",
        authorId: authorA,
        likes: 0,
      });
      await storage.insert(deepSchema.comments, {
        id: commentA,
        content: "a",
        postId: post,
        authorId: authorA,
      });
      await storage.insert(deepSchema.comments, {
        id: commentB,
        content: "b",
        postId: post,
        authorId: authorB,
      });
      await storage.insert(deepSchema.comments, {
        id: commentC,
        content: "c",
        postId: post,
        authorId: authorC,
      });
    };

    // posts -> each post's top-2 comments ordered by the comment author's name.
    const subscribeWindowedComments = (mutations: any[]) =>
      handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          include: {
            comments: {
              limit: 2,
              orderBy: [{ key: "author.name", direction: "asc" }],
            },
          },
        },
        subscription: (m) => mutations.push(m),
      });

    const commentIds = (data: any[]): string[] => {
      const p = data.find((row: any) => row.value.id.value === post);
      const comments = p?.value?.comments?.value ?? [];
      return comments.map((c: any) => c.value.id.value);
    };

    test("seeds each post's comment window in author-name order", async () => {
      await setup();
      const result = await subscribeWindowedComments([]);

      // Top-2 by author name asc: Alice's comment, then Bob's. Carol is outside.
      expect(commentIds(result.data)).toEqual([commentA, commentB]);

      // The engine-added `author` relation (pulled in only to derive sort keys)
      // is stripped from the nested comment rows.
      const p = result.data.find((row: any) => row.value.id.value === post);
      expect(p.value.comments.value[0].value.author).toBeUndefined();

      result.unsubscribe?.();
    });

    test("author rename demotes an in-window comment (DELETE) and backfills the unseen one (INSERT)", async () => {
      await setup();
      const mutations: any[] = [];
      const result = await subscribeWindowedComments(mutations);
      expect(commentIds(result.data)).toEqual([commentA, commentB]);

      // Alice -> "Zed": order becomes Bob, Carol, Zed, so commentA leaves the
      // top-2 and commentC (never loaded) must be promoted via a boundary read.
      await storage.update(deepSchema.users, authorA, { name: "Zed" });
      await settle();

      const del = mutations.find(
        (m) => m.resourceId === commentA && m.op === "DELETE"
      );
      expect(del).toBeDefined();
      expect(del.payload).toEqual({});

      const backfill = mutations.find(
        (m) => m.resourceId === commentC && m.op === "INSERT"
      );
      expect(backfill).toBeDefined();
      expect(backfill.payload.content.value).toBe("c");
      // The INSERT carries the comment's own columns, not the author the engine
      // included to order the boundary read.
      expect(backfill.payload.author).toBeUndefined();

      result.unsubscribe?.();
    });

    test("renaming an out-of-window author promotes its unseen comment (INSERT) and evicts the boundary (DELETE)", async () => {
      await setup();
      const mutations: any[] = [];
      const result = await subscribeWindowedComments(mutations);
      expect(commentIds(result.data)).toEqual([commentA, commentB]);

      // Carol -> "Aaa" (out-of-window commentC): order becomes Aaa, Alice, Bob,
      // so commentC enters the top-2 and Bob's commentB is evicted. No in-window
      // comment changed, so only the boundary read can catch this promotion.
      await storage.update(deepSchema.users, authorC, { name: "Aaa" });
      await settle();

      const promoted = mutations.find(
        (m) => m.resourceId === commentC && m.op === "INSERT"
      );
      expect(promoted).toBeDefined();
      expect(promoted.payload.content.value).toBe("c");

      const evicted = mutations.find(
        (m) => m.resourceId === commentB && m.op === "DELETE"
      );
      expect(evicted).toBeDefined();
      expect(evicted.payload).toEqual({});

      result.unsubscribe?.();
    });

    test("author rename that only reorders within the comment window emits no delta", async () => {
      await setup();
      const mutations: any[] = [];
      const result = await subscribeWindowedComments(mutations);
      expect(commentIds(result.data)).toEqual([commentA, commentB]);

      // Alice -> "Boris": the window is still {commentA, commentB} but their
      // order flips (Bob before Boris). Membership is unchanged, so nothing is
      // broadcast — the client re-sorts the rows it holds.
      await storage.update(deepSchema.users, authorA, { name: "Boris" });
      await settle();

      expect(
        mutations.some(
          (m) =>
            (m.op === "INSERT" || m.op === "DELETE") &&
            [commentA, commentB, commentC].includes(m.resourceId)
        )
      ).toBe(false);

      result.unsubscribe?.();
    });
  });
});
