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
  expect,
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
    orgs: publicRoute.collectionRoute(deepSchema.orgs, {
      read: ({ ctx }) => {
        if (ctx.org) {
          return { name: ctx.org };
        }

        return false;
      },
    }),
    users: publicRoute.collectionRoute(deepSchema.users, {
      read: () => true,
    }),
    posts: publicRoute.collectionRoute(deepSchema.posts, {
      read: () => true,
    }),
    comments: publicRoute.collectionRoute(deepSchema.comments, {
      read: () => true,
    }),
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

    // Insert test data for first org (Acme Corp)
    const orgId1 = generateId();
    const userId1 = generateId();
    const userId2 = generateId();
    const postId1 = generateId();
    const postId2 = generateId();
    const commentId1 = generateId();
    const commentId2 = generateId();
    const commentId3 = generateId();

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

    // Insert test data for second org (Tech Inc)
    const orgId2 = generateId();
    const userId3 = generateId();
    const userId4 = generateId();
    const postId3 = generateId();
    const postId4 = generateId();
    const commentId4 = generateId();
    const commentId5 = generateId();
    const commentId6 = generateId();

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
    });

    // Verify we got the org data
    expect(result.data).toBeDefined();
    expect(result.data.length).toBe(1);

    // Verify users are included
    const org = result.data[0];
    expect(org.value.users).toBeDefined();
    expect(org.value.users.value).toBeDefined();
    expect(Array.isArray(org.value.users.value)).toBe(true);
    expect(org.value.users.value.length).toBe(2); // John and Jane

    // Verify posts are included for each user
    for (const user of org.value.users.value) {
      expect(user.value.posts).toBeDefined();
      expect(Array.isArray(user.value.posts.value)).toBe(true);

      // Verify comments are included for each post
      for (const post of user.value.posts.value) {
        expect(post.value.comments).toBeDefined();
        expect(Array.isArray(post.value.comments.value)).toBe(true);
      }
    }

    console.log("Query result:", JSON.stringify(result, null, 2));
  });

  describe("handle insert mutations", () => {
    test("subscribes to a simple query and receives notification when matching value is inserted", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to all posts
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns existing posts
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);

      // Get a user ID to use as authorId for the new post
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const userId = existingUsers[0].value.id.value;

      // Insert a new post that matches the query
      const newPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: "New Post",
        content: "This is a new post",
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.resource).toBe("posts");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(newPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with simple where clause and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with likes > 10
      const result = await testServer.handleQuery({
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
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns posts with likes > 10
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);

      // Get a user ID
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const userId = existingUsers[0].value.id.value;

      // Insert a post that matches (likes = 15)
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "High Likes Post",
        content: "This post has many likes",
        authorId: userId,
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);

      // Insert a post that doesn't match (likes = 5)
      const nonMatchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: nonMatchingPostId,
        title: "Low Likes Post",
        content: "This post has few likes",
        authorId: userId,
        likes: 5,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was NOT called again
      expect(subscriptionCallbacks.length).toBe(1);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with deep where clause (author relation) and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a specific user to filter by
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;

      // Subscribe to posts where author name matches
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              name: targetUserName,
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns posts by the target author
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);

      // Insert a post by the matching author
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "Post by Target Author",
        content: "This post is by the target author",
        authorId: targetUserId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with deep where clause (author.org relation) and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a specific org to filter by
      const existingOrgs = await storage.get({
        resource: "orgs",
        limit: 1,
      });
      expect(existingOrgs.length).toBeGreaterThan(0);
      const targetOrgId = existingOrgs[0].value.id.value;
      const targetOrgName = existingOrgs[0].value.name.value;

      // Get a user from that org
      const orgUsers = await storage.get({
        resource: "users",
        where: { orgId: targetOrgId },
        limit: 1,
      });
      expect(orgUsers.length).toBeGreaterThan(0);
      const userId = orgUsers[0].value.id.value;

      // Subscribe to posts where author's org name matches
      const result = await testServer.handleQuery({
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
                name: targetOrgName,
              },
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns posts by authors from the target org
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);

      // Insert a post by an author from the matching org
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "Post by Author from Target Org",
        content: "This post is by an author from the target org",
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with combined where clause (field + relation) and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a specific user
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;

      // Subscribe to posts with likes > 5 AND author name matches
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            likes: { $gt: 5 },
            author: {
              name: targetUserName,
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns matching posts
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);

      // Insert a post that matches both conditions
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "Matching Post",
        content: "This post matches both conditions",
        authorId: targetUserId,
        likes: 10,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);

      // Insert a post that only matches one condition (likes > 5 but wrong author)
      const partialMatchPostId = generateId();
      // Get a different user
      const otherUsers = await storage.get({
        resource: "users",
        where: { id: { $not: { $eq: targetUserId } } },
        limit: 1,
      });
      if (otherUsers.length > 0) {
        const otherUserId = otherUsers[0].value.id.value;
        await storage.insert(deepSchema.posts, {
          id: partialMatchPostId,
          title: "Partial Match Post",
          content: "This post only matches likes condition",
          authorId: otherUserId,
          likes: 10,
        });

        // Wait for async operations to complete
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify the subscription callback was NOT called again
        expect(subscriptionCallbacks.length).toBe(1);
      }

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with $and operator and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a specific user
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;

      // Subscribe to posts with $and operator
      const result = await testServer.handleQuery({
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
                  name: targetUserName,
                },
              },
            ],
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns matching posts
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);

      // Insert a post that matches all $and conditions
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "And Condition Post",
        content: "This post matches all $and conditions",
        authorId: targetUserId,
        likes: 8,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with $in operator and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with specific titles
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            title: { $in: ["First Post", "Second Post", "New Matching Post"] },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns posts with matching titles
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);

      // Get a user ID
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const userId = existingUsers[0].value.id.value;

      // Insert a post with a matching title
      const matchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: "New Matching Post",
        content: "This post has a matching title",
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);

      // Insert a post with a non-matching title
      const nonMatchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: nonMatchingPostId,
        title: "Non Matching Post",
        content: "This post doesn't match",
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was NOT called again
      expect(subscriptionCallbacks.length).toBe(1);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });

  describe("handle update mutations", () => {
    test("subscribes to a query and receives UPDATE notification when matching object is updated", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get an existing post
      const existingPosts = await storage.get({
        resource: "posts",
        limit: 1,
      });
      expect(existingPosts.length).toBeGreaterThan(0);
      const postId = existingPosts[0].value.id.value;

      // Subscribe to all posts
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns existing posts
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post
      await storage.update(deepSchema.posts, postId, {
        title: "Updated Title",
        likes: 20,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called with UPDATE mutation
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.resource).toBe("posts");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and receives UPDATE when object continues to match", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes > 10
      const existingPosts = await storage.get({
        resource: "posts",
        where: { likes: { $gt: 10 } },
        limit: 1,
      });
      expect(existingPosts.length).toBeGreaterThan(0);
      const postId = existingPosts[0].value.id.value;

      // Subscribe to posts with likes > 10
      const result = await testServer.handleQuery({
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
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post but keep likes > 10 (still matches)
      await storage.update(deepSchema.posts, postId, {
        title: "Still Matching Post",
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called with UPDATE
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and receives INSERT when object starts matching", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes <= 10
      const existingPosts = await storage.get({
        resource: "posts",
        where: { likes: { $lte: 10 } },
        limit: 1,
      });
      expect(existingPosts.length).toBeGreaterThan(0);
      const postId = existingPosts[0].value.id.value;
      const initialLikes = existingPosts[0].value.likes.value;

      // Subscribe to posts with likes > 10
      const result = await testServer.handleQuery({
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
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the post is not in the initial results
      const initialResults = result.data.filter((p: any) => p.id === postId);
      expect(initialResults.length).toBe(0);

      // Update the post to have likes > 10 (now matches)
      await storage.update(deepSchema.posts, postId, {
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called with INSERT (newly matched)
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(15);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and receives UPDATE when object stops matching", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes > 10
      const existingPosts = await storage.get({
        resource: "posts",
        where: { likes: { $gt: 10 } },
        limit: 1,
      });
      expect(existingPosts.length).toBeGreaterThan(0);
      const postId = existingPosts[0].value.id.value;

      // Subscribe to posts with likes > 10
      const result = await testServer.handleQuery({
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
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the post is in the initial results
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId
      );
      expect(initialResults.length).toBe(1);

      // Update the post to have likes <= 10 (no longer matches)
      await storage.update(deepSchema.posts, postId, {
        likes: 5,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called with UPDATE
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and handles object changing from matching to not matching to matching again", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes > 10
      const existingPosts = await storage.get({
        resource: "posts",
        where: { likes: { $gt: 10 } },
        limit: 1,
      });
      expect(existingPosts.length).toBeGreaterThan(0);
      const postId = existingPosts[0].value.id.value;

      // Subscribe to posts with likes > 10
      const result = await testServer.handleQuery({
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
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update 1: Change to not match (should receive UPDATE)
      await storage.update(deepSchema.posts, postId, {
        likes: 5,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify first update
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");

      // Update 2: Change back to match (should receive INSERT with full data)
      await storage.update(deepSchema.posts, postId, {
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify second update
      expect(subscriptionCallbacks.length).toBe(2);
      expect(subscriptionCallbacks[1].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[1].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[1].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[1].mutation.payload.likes.value).toBe(15);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with deep where clause and receives UPDATE when object continues to match", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a specific user
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBeGreaterThan(0);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;

      // Get a post by this user
      const userPosts = await storage.get({
        resource: "posts",
        where: { authorId: targetUserId },
        limit: 1,
      });
      expect(userPosts.length).toBeGreaterThan(0);
      const postId = userPosts[0].value.id.value;

      // Subscribe to posts where author name matches
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              name: targetUserName,
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post (author name unchanged, still matches)
      await storage.update(deepSchema.posts, postId, {
        title: "Updated Post Title",
        likes: 25,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called with UPDATE
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with deep where clause and receives INSERT when object starts matching after author change", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get two different users
      const allUsers = await storage.get({
        resource: "users",
        limit: 2,
      });
      expect(allUsers.length).toBeGreaterThanOrEqual(2);
      const targetUserId = allUsers[0].value.id.value;
      const targetUserName = allUsers[0].value.name.value;
      const otherUserId = allUsers[1].value.id.value;

      // Get a post by the other user (not matching)
      const otherUserPosts = await storage.get({
        resource: "posts",
        where: { authorId: otherUserId },
        limit: 1,
      });
      expect(otherUserPosts.length).toBeGreaterThan(0);
      const postId = otherUserPosts[0].value.id.value;

      // Subscribe to posts where author name matches target user
      const result = await testServer.handleQuery({
        req: {
          type: "QUERY",
          resource: "posts",
          headers: {},
          cookies: {},
          queryParams: {},
          context: {},
          where: {
            author: {
              name: targetUserName,
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the post is not in the initial results
      const initialResults = result.data.filter((p: any) => p.id === postId);
      expect(initialResults.length).toBe(0);

      // Update the post to change author to target user (now matches)
      await storage.update(deepSchema.posts, postId, {
        authorId: targetUserId,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify the subscription callback was called with INSERT (newly matched)
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to multiple queries and receives correct mutations for each", async () => {
      const query1Callbacks: Array<{ mutation: any }> = [];
      const query2Callbacks: Array<{ mutation: any }> = [];

      // Get a post with likes > 10
      const existingPosts = await storage.get({
        resource: "posts",
        where: { likes: { $gt: 10 } },
        limit: 1,
      });
      expect(existingPosts.length).toBeGreaterThan(0);
      const postId = existingPosts[0].value.id.value;

      // Subscribe to posts with likes > 10
      const result1 = await testServer.handleQuery({
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
        subscription: (mutation) => {
          query1Callbacks.push({ mutation });
        },
      });

      // Subscribe to posts with likes > 20
      const result2 = await testServer.handleQuery({
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
        testNewEngine: true,
        subscription: (mutation) => {
          query2Callbacks.push({ mutation });
        },
      });

      // Wait for initial subscriptions to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update post to likes = 15 (matches query1, still matches query2 if it was matching)
      await storage.update(deepSchema.posts, postId, {
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Query1 should receive UPDATE (continues to match)
      expect(query1Callbacks.length).toBe(1);
      expect(query1Callbacks[0].mutation.procedure).toBe("UPDATE");

      // Query2 should receive UPDATE if it was matching, or nothing if it wasn't
      // (depends on initial likes value)

      // Now update to likes = 25 (matches both)
      await storage.update(deepSchema.posts, postId, {
        likes: 25,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Query1 should receive another UPDATE (continues to match)
      expect(query1Callbacks.length).toBe(2);
      expect(query1Callbacks[1].mutation.procedure).toBe("UPDATE");

      // Query2 should receive INSERT if it wasn't matching before, or UPDATE if it was
      expect(query2Callbacks.length).toBeGreaterThan(0);
      const lastQuery2Mutation = query2Callbacks[query2Callbacks.length - 1];
      expect(
        lastQuery2Mutation.mutation.procedure === "INSERT" ||
          lastQuery2Mutation.mutation.procedure === "UPDATE"
      ).toBe(true);

      // Clean up subscriptions
      if (result1.unsubscribe) {
        result1.unsubscribe();
      }
      if (result2.unsubscribe) {
        result2.unsubscribe();
      }
    });

    test("subscribes to org > posts > comments and moves a post to the acme org", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get the acme org
      const acmeOrg = await storage.get({
        resource: "orgs",
        where: { name: "acme" },
        limit: 1,
      });
      const acmeOrgId = acmeOrg[0].value.id.value;

      // Get a user from acme org
      const acmeUsers = await storage.get({
        resource: "users",
        where: { orgId: acmeOrgId },
        limit: 1,
      });
      const acmeUserId = acmeUsers[0].value.id.value;

      // Get a post from tech org (not acme)
      const techOrg = await storage.get({
        resource: "orgs",
        where: { name: "tech" },
        limit: 1,
      });
      const techOrgId = techOrg[0].value.id.value;
      const techUsers = await storage.get({
        resource: "users",
        where: { orgId: techOrgId },
        limit: 1,
      });
      const techUserId = techUsers[0].value.id.value;
      const techUserPosts = await storage.get({
        resource: "posts",
        where: { authorId: techUserId },
        limit: 1,
      });
      const postId = techUserPosts[0].value.id.value;

      // Subscribe to orgs with nested includes: users > posts > comments
      const result = await testServer.handleQuery({
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
                comments: {
                  author: true,
                },
              },
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert a new post matching the query (author from acme org)
      const newPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: "New Post from Acme",
        content: "This post matches the query",
        authorId: acmeUserId,
        likes: 0,
      });

      // Insert a new post that doesn't match the query (author from tech org)
      const nonMatchingPostId = generateId();
      await storage.insert(deepSchema.posts, {
        id: nonMatchingPostId,
        title: "New Post from Tech",
        content: "This post does NOT match the query",
        authorId: techUserId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Move the post to acme org by updating its authorId to a user from acme org
      await storage.update(deepSchema.posts, postId, {
        authorId: acmeUserId,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });
});
