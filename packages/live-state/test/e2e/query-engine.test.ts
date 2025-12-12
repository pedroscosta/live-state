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

  // Store test data IDs for assertions
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

    // Insert test data for second org (Tech Inc)
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

  describe("debug tests", () => {
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

      // Verify initial query returns exactly 4 existing posts (from setup)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(4);

      // Verify all posts have required fields
      result.data.forEach((post: any) => {
        expect(post.value.id).toBeDefined();
        expect(post.value.title).toBeDefined();
        expect(post.value.content).toBeDefined();
        expect(post.value.authorId).toBeDefined();
        expect(post.value.likes).toBeDefined();
      });

      // Get a user ID to use as authorId for the new post
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const userId = existingUsers[0].value.id.value;

      // Insert a new post that matches the query
      const newPostId = generateId();
      const newPostTitle = "New Post";
      const newPostContent = "This is a new post";
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: newPostTitle,
        content: newPostContent,
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);

      // Verify mutation details
      const mutation = subscriptionCallbacks[0].mutation;
      expect(mutation).toBeDefined();
      expect(mutation.resource).toBe("posts");
      expect(mutation.resourceId).toBe(newPostId);
      expect(mutation.procedure).toBe("INSERT");
      expect(mutation.payload).toBeDefined();
      expect(mutation.payload.title.value).toBe(newPostTitle);
      expect(mutation.payload.content.value).toBe(newPostContent);
      expect(mutation.payload.authorId.value).toBe(userId);
      expect(mutation.payload.likes.value).toBe(0);

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

      // Verify initial query returns exactly 1 post with likes > 10 (postId3 with 15 likes)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId3);
      expect(result.data[0].value.likes.value).toBe(15);

      // Get a user ID
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const userId = existingUsers[0].value.id.value;

      // Insert a post that matches (likes = 15)
      const matchingPostId = generateId();
      const matchingPostTitle = "High Likes Post";
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: matchingPostTitle,
        content: "This post has many likes",
        authorId: userId,
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(15);
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        matchingPostTitle
      );

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
        where: { id: userId1 },
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;
      expect(targetUserName).toBe("John Doe");

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

      // Verify initial query returns exactly 1 post by John Doe (postId1)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);

      // Insert a post by the matching author
      const matchingPostId = generateId();
      const matchingPostTitle = "Post by Target Author";
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: matchingPostTitle,
        content: "This post is by the target author",
        authorId: targetUserId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        matchingPostTitle
      );
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        targetUserId
      );

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with deep where clause (author.org relation) and receives notification for matching insert", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get the acme org
      const existingOrgs = await storage.get({
        resource: "orgs",
        where: { id: orgId1 },
        limit: 1,
      });
      expect(existingOrgs.length).toBe(1);
      const targetOrgId = existingOrgs[0].value.id.value;
      const targetOrgName = existingOrgs[0].value.name.value;
      expect(targetOrgId).toBe(orgId1);
      expect(targetOrgName).toBe("acme");

      // Get a user from that org
      const orgUsers = await storage.get({
        resource: "users",
        where: { orgId: targetOrgId },
        limit: 1,
      });
      expect(orgUsers.length).toBe(1);
      const userId = orgUsers[0].value.id.value;
      expect([userId1, userId2]).toContain(userId);

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

      // Verify initial query returns exactly 2 posts by authors from acme org (postId1 and postId2)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(2);
      const returnedPostIds = result.data.map((p: any) => p.value.id.value);
      expect(returnedPostIds).toContain(postId1);
      expect(returnedPostIds).toContain(postId2);

      // Insert a post by an author from the matching org
      const matchingPostId = generateId();
      const matchingPostTitle = "Post by Author from Target Org";
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: matchingPostTitle,
        content: "This post is by an author from the target org",
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        matchingPostTitle
      );
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        userId
      );

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
        where: { id: userId1 },
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;
      expect(targetUserName).toBe("John Doe");

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

      // Verify initial query returns exactly 1 post (postId1: likes=10, author=John Doe)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);
      expect(result.data[0].value.likes.value).toBe(10);

      // Insert a post that matches both conditions
      const matchingPostId = generateId();
      const matchingPostTitle = "Matching Post";
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: matchingPostTitle,
        content: "This post matches both conditions",
        authorId: targetUserId,
        likes: 10,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(10);
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        targetUserId
      );

      // Insert a post that only matches one condition (likes > 5 but wrong author)
      const partialMatchPostId = generateId();
      // Get a different user (Jane Smith)
      const otherUsers = await storage.get({
        resource: "users",
        where: { id: userId2 },
        limit: 1,
      });
      expect(otherUsers.length).toBe(1);
      const otherUserId = otherUsers[0].value.id.value;
      expect(otherUserId).toBe(userId2);

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
        where: { id: userId1 },
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;
      expect(targetUserName).toBe("John Doe");

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

      // Verify initial query returns exactly 1 post (postId1: likes=10, author=John Doe)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);

      // Insert a post that matches all $and conditions
      const matchingPostId = generateId();
      const matchingPostTitle = "And Condition Post";
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: matchingPostTitle,
        content: "This post matches all $and conditions",
        authorId: targetUserId,
        likes: 8,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(8);
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        targetUserId
      );

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

      // Verify initial query returns exactly 2 posts (First Post and Second Post)
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(2);
      const returnedTitles = result.data.map((p: any) => p.value.title.value);
      expect(returnedTitles).toContain("First Post");
      expect(returnedTitles).toContain("Second Post");

      // Get a user ID
      const existingUsers = await storage.get({
        resource: "users",
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const userId = existingUsers[0].value.id.value;

      // Insert a post with a matching title
      const matchingPostId = generateId();
      const matchingPostTitle = "New Matching Post";
      await storage.insert(deepSchema.posts, {
        id: matchingPostId,
        title: matchingPostTitle,
        content: "This post has a matching title",
        authorId: userId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(matchingPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        matchingPostTitle
      );

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
        where: { id: postId1 },
        limit: 1,
      });
      expect(existingPosts.length).toBe(1);
      const postId = existingPosts[0].value.id.value;
      expect(postId).toBe(postId1);
      const initialTitle = existingPosts[0].value.title.value;
      expect(initialTitle).toBe("First Post");

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

      // Verify initial query returns exactly 4 existing posts
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(4);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post
      const updatedTitle = "Updated Title";
      const updatedLikes = 20;
      await storage.update(deepSchema.posts, postId, {
        title: updatedTitle,
        likes: updatedLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called with UPDATE mutation
      expect(subscriptionCallbacks.length).toBe(1);
      const mutation = subscriptionCallbacks[0].mutation;
      expect(mutation).toBeDefined();
      expect(mutation.resource).toBe("posts");
      expect(mutation.resourceId).toBe(postId);
      expect(mutation.procedure).toBe("UPDATE");
      expect(mutation.payload).toBeDefined();
      expect(mutation.payload.title.value).toBe(updatedTitle);
      expect(mutation.payload.likes.value).toBe(updatedLikes);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and receives UPDATE when object continues to match", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes > 10 (postId3 with 15 likes)
      const existingPosts = await storage.get({
        resource: "posts",
        where: { id: postId3 },
        limit: 1,
      });
      expect(existingPosts.length).toBe(1);
      const postId = existingPosts[0].value.id.value;
      expect(postId).toBe(postId3);
      expect(existingPosts[0].value.likes.value).toBe(15);

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

      // Verify initial query returns exactly 1 post (postId3)
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId3);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post but keep likes > 10 (still matches)
      const updatedTitle = "Still Matching Post";
      const updatedLikes = 15;
      await storage.update(deepSchema.posts, postId, {
        title: updatedTitle,
        likes: updatedLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called with UPDATE
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        updatedTitle
      );
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(
        updatedLikes
      );

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and receives INSERT when object starts matching", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes <= 10 (postId2 with 5 likes)
      const existingPosts = await storage.get({
        resource: "posts",
        where: { id: postId2 },
        limit: 1,
      });
      expect(existingPosts.length).toBe(1);
      const postId = existingPosts[0].value.id.value;
      expect(postId).toBe(postId2);
      const initialLikes = existingPosts[0].value.likes.value;
      expect(initialLikes).toBe(5);

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
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId
      );
      expect(initialResults.length).toBe(0);

      // Update the post to have likes > 10 (now matches)
      const updatedLikes = 15;
      await storage.update(deepSchema.posts, postId, {
        likes: updatedLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called with INSERT (newly matched)
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(
        updatedLikes
      );
      expect(subscriptionCallbacks[0].mutation.payload.id.value).toBe(postId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and receives UPDATE when object stops matching", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes > 10 (postId3 with 15 likes)
      const existingPosts = await storage.get({
        resource: "posts",
        where: { id: postId3 },
        limit: 1,
      });
      expect(existingPosts.length).toBe(1);
      const postId = existingPosts[0].value.id.value;
      expect(postId).toBe(postId3);
      expect(existingPosts[0].value.likes.value).toBe(15);

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
      const updatedLikes = 5;
      await storage.update(deepSchema.posts, postId, {
        likes: updatedLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called with UPDATE
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(
        updatedLikes
      );

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with where clause and handles object changing from matching to not matching to matching again", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a post with likes > 10 (postId3 with 15 likes)
      const existingPosts = await storage.get({
        resource: "posts",
        where: { id: postId3 },
        limit: 1,
      });
      expect(existingPosts.length).toBe(1);
      const postId = existingPosts[0].value.id.value;
      expect(postId).toBe(postId3);
      expect(existingPosts[0].value.likes.value).toBe(15);

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

      // Verify post is initially in results
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId
      );
      expect(initialResults.length).toBe(1);

      // Update 1: Change to not match (should receive UPDATE)
      const nonMatchingLikes = 5;
      await storage.update(deepSchema.posts, postId, {
        likes: nonMatchingLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify first update
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(
        nonMatchingLikes
      );

      // Update 2: Change back to match (should receive INSERT with full data)
      const matchingLikes = 15;
      await storage.update(deepSchema.posts, postId, {
        likes: matchingLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify second update
      expect(subscriptionCallbacks.length).toBe(2);
      expect(subscriptionCallbacks[1].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[1].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[1].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[1].mutation.payload.likes.value).toBe(
        matchingLikes
      );
      expect(subscriptionCallbacks[1].mutation.payload.id.value).toBe(postId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes with deep where clause and receives UPDATE when object continues to match", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Get a specific user (John Doe)
      const existingUsers = await storage.get({
        resource: "users",
        where: { id: userId1 },
        limit: 1,
      });
      expect(existingUsers.length).toBe(1);
      const targetUserId = existingUsers[0].value.id.value;
      const targetUserName = existingUsers[0].value.name.value;
      expect(targetUserId).toBe(userId1);
      expect(targetUserName).toBe("John Doe");

      // Get a post by this user (postId1)
      const userPosts = await storage.get({
        resource: "posts",
        where: { id: postId1 },
        limit: 1,
      });
      expect(userPosts.length).toBe(1);
      const postId = userPosts[0].value.id.value;
      expect(postId).toBe(postId1);
      expect(userPosts[0].value.authorId.value).toBe(userId1);

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

      // Verify initial query returns exactly 1 post (postId1)
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post (author name unchanged, still matches)
      const updatedTitle = "Updated Post Title";
      const updatedLikes = 25;
      await storage.update(deepSchema.posts, postId, {
        title: updatedTitle,
        likes: updatedLikes,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called with UPDATE
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        updatedTitle
      );
      expect(subscriptionCallbacks[0].mutation.payload.likes.value).toBe(
        updatedLikes
      );

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
        where: { id: { $in: [userId1, userId2] } },
        limit: 2,
      });
      expect(allUsers.length).toBe(2);
      const targetUserId = userId1;
      const targetUserName = "John Doe";
      const otherUserId = userId2;
      expect(otherUserId).not.toBe(targetUserId);

      // Get a post by the other user (Jane Smith - postId2)
      const otherUserPosts = await storage.get({
        resource: "posts",
        where: { id: postId2 },
        limit: 1,
      });
      expect(otherUserPosts.length).toBe(1);
      const postId = otherUserPosts[0].value.id.value;
      expect(postId).toBe(postId2);
      expect(otherUserPosts[0].value.authorId.value).toBe(userId2);

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
      const initialResults = result.data.filter(
        (p: any) => p.value.id.value === postId
      );
      expect(initialResults.length).toBe(0);

      // Update the post to change author to target user (now matches)
      await storage.update(deepSchema.posts, postId, {
        authorId: targetUserId,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify exactly one subscription callback was called with INSERT (newly matched)
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId);
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        targetUserId
      );
      expect(subscriptionCallbacks[0].mutation.payload.id.value).toBe(postId);

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to multiple queries and receives correct mutations for each", async () => {
      const query1Callbacks: Array<{ mutation: any }> = [];
      const query2Callbacks: Array<{ mutation: any }> = [];

      // Get a post with likes > 10 (postId3 with 15 likes)
      const existingPosts = await storage.get({
        resource: "posts",
        where: { id: postId3 },
        limit: 1,
      });
      expect(existingPosts.length).toBe(1);
      const postId = existingPosts[0].value.id.value;
      expect(postId).toBe(postId3);
      const initialLikes = existingPosts[0].value.likes.value;
      expect(initialLikes).toBe(15);

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

      // Verify initial query1 returns exactly 1 post (postId3)
      expect(result1.data.length).toBe(1);
      expect(result1.data[0].value.id.value).toBe(postId3);

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

      // Verify initial query2 returns 0 posts (no posts with likes > 20)
      expect(result2.data.length).toBe(0);

      // Wait for initial subscriptions to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update post to likes = 15 (matches query1, doesn't match query2)
      await storage.update(deepSchema.posts, postId, {
        likes: 15,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Query1 should receive UPDATE (continues to match)
      expect(query1Callbacks.length).toBe(1);
      expect(query1Callbacks[0].mutation.procedure).toBe("UPDATE");
      expect(query1Callbacks[0].mutation.resourceId).toBe(postId);
      expect(query1Callbacks[0].mutation.payload.likes.value).toBe(15);

      // Query2 should receive nothing (still doesn't match)
      expect(query2Callbacks.length).toBe(0);

      // Now update to likes = 25 (matches both)
      await storage.update(deepSchema.posts, postId, {
        likes: 25,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Query1 should receive another UPDATE (continues to match)
      expect(query1Callbacks.length).toBe(2);
      expect(query1Callbacks[1].mutation.procedure).toBe("UPDATE");
      expect(query1Callbacks[1].mutation.resourceId).toBe(postId);
      expect(query1Callbacks[1].mutation.payload.likes.value).toBe(25);

      // Query2 should receive INSERT (now matches)
      expect(query2Callbacks.length).toBe(1);
      expect(query2Callbacks[0].mutation.procedure).toBe("INSERT");
      expect(query2Callbacks[0].mutation.resourceId).toBe(postId);
      expect(query2Callbacks[0].mutation.payload.likes.value).toBe(25);

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
        where: { id: orgId1 },
        limit: 1,
      });
      expect(acmeOrg.length).toBe(1);
      const acmeOrgId = acmeOrg[0].value.id.value;
      expect(acmeOrgId).toBe(orgId1);

      // Get a user from acme org
      const acmeUsers = await storage.get({
        resource: "users",
        where: { id: userId1 },
        limit: 1,
      });
      expect(acmeUsers.length).toBe(1);
      const acmeUserId = acmeUsers[0].value.id.value;
      expect(acmeUserId).toBe(userId1);

      // Get a post from tech org (not acme) - postId3 or postId4
      const techOrg = await storage.get({
        resource: "orgs",
        where: { id: orgId2 },
        limit: 1,
      });
      expect(techOrg.length).toBe(1);
      const techOrgId = techOrg[0].value.id.value;
      expect(techOrgId).toBe(orgId2);

      const techUsers = await storage.get({
        resource: "users",
        where: { id: userId3 },
        limit: 1,
      });
      expect(techUsers.length).toBe(1);
      const techUserId = techUsers[0].value.id.value;
      expect(techUserId).toBe(userId3);

      const techUserPosts = await storage.get({
        resource: "posts",
        where: { id: postId3 },
        limit: 1,
      });
      expect(techUserPosts.length).toBe(1);
      const postId = techUserPosts[0].value.id.value;
      expect(postId).toBe(postId3);
      expect(techUserPosts[0].value.authorId.value).toBe(userId3);

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

      // Verify initial query returns exactly 1 org (acme)
      expect(result.data.length).toBe(1);
      expect(result.data[0].value.name.value).toBe("acme");
      expect(result.data[0].value.users.value.length).toBe(2); // John and Jane

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Insert a new post matching the query (author from acme org)
      const newPostId = generateId();
      const newPostTitle = "New Post from Acme";
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: newPostTitle,
        content: "This post matches the query",
        authorId: acmeUserId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify subscription was called for the new post
      const newPostMutations = subscriptionCallbacks.filter(
        (cb) => cb.mutation.resourceId === newPostId
      );
      expect(newPostMutations.length).toBeGreaterThan(0);
      expect(newPostMutations[0].mutation.procedure).toBe("INSERT");

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

      // Verify no mutation for non-matching post (it shouldn't trigger for org query)
      const nonMatchingMutations = subscriptionCallbacks.filter(
        (cb) => cb.mutation.resourceId === nonMatchingPostId
      );
      expect(nonMatchingMutations.length).toBe(0);

      // Move the post to acme org by updating its authorId to a user from acme org
      await storage.update(deepSchema.posts, postId, {
        authorId: acmeUserId,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the moved post
      const movedPostMutations = subscriptionCallbacks.filter(
        (cb) => cb.mutation.resourceId === postId
      );
      expect(movedPostMutations.length).toBeGreaterThan(0);
      const lastMovedMutation =
        movedPostMutations[movedPostMutations.length - 1];
      expect(lastMovedMutation.mutation.procedure).toBe("INSERT");
      expect(lastMovedMutation.mutation.payload.authorId.value).toBe(
        acmeUserId
      );

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });

  describe("queries with include clauses", () => {
    test("subscribes to posts with single-level include (author) and receives notification when included author is created", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with author included
      const result = await testServer.handleQuery({
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
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 4 posts with authors included
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(4);

      // Verify all posts have author included
      result.data.forEach((post: any) => {
        expect(post.value.author).toBeDefined();
        expect(post.value.author.value).toBeDefined();
        expect(post.value.author.value.id).toBeDefined();
        expect(post.value.author.value.name).toBeDefined();
        expect(post.value.author.value.email).toBeDefined();
      });

      // Create a new user
      const newUserId = generateId();
      const newUserName = "New User";
      const newUserEmail = "newuser@example.com";
      await storage.insert(deepSchema.users, {
        id: newUserId,
        name: newUserName,
        email: newUserEmail,
        orgId: orgId1,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify no mutation for user creation (user is not the queried resource)
      expect(subscriptionCallbacks.length).toBe(0);

      // Create a new post with the new author
      const newPostId = generateId();
      const newPostTitle = "Post by New User";
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: newPostTitle,
        content: "Content by new user",
        authorId: newUserId,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the new post
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resource).toBe("posts");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(newPostId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.payload.title.value).toBe(
        newPostTitle
      );
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        newUserId
      );

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to posts with single-level include (author) and receives notification when included author is updated", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with author included
      const result = await testServer.handleQuery({
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
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 4 posts
      expect(result.data.length).toBe(4);

      // Get postId1 which has author userId1
      const post1 = result.data.find((p: any) => p.value.id.value === postId1);
      expect(post1).toBeDefined();
      expect(post1!).toBeDefined();
      expect(post1!.value.author.value.id.value).toBe(userId1);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the author's name
      const updatedName = "John Updated";
      await storage.update(deepSchema.users, userId1, {
        name: updatedName,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the post (because author changed)
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resource).toBe("users");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(userId1);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to posts with single-level include (comments) and receives notification when included comment is created", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with comments included
      const result = await testServer.handleQuery({
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
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 4 posts
      expect(result.data.length).toBe(4);

      // Verify postId1 has 2 comments included
      const post1 = result.data.find((p: any) => p.value.id.value === postId1);
      expect(post1).toBeDefined();
      expect(post1!).toBeDefined();
      expect(post1!.value.comments).toBeDefined();
      expect(post1!.value.comments.value).toBeDefined();
      expect(Array.isArray(post1!.value.comments.value)).toBe(true);
      expect(post1!.value.comments.value.length).toBe(2);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a new comment on postId1
      const newCommentId = generateId();
      const newCommentContent = "New comment";
      await storage.insert(deepSchema.comments, {
        id: newCommentId,
        content: newCommentContent,
        postId: postId1,
        authorId: userId1,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the post (because comment was added)
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resource).toBe("comments");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(newCommentId);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("INSERT");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to posts with two-level include (author.org) and receives notification when nested org is updated", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with author and author.org included
      const result = await testServer.handleQuery({
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
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 4 posts
      expect(result.data.length).toBe(4);

      // Verify postId1 has author with org included
      const post1 = result.data.find((p: any) => p.value.id.value === postId1);
      expect(post1).toBeDefined();
      expect(post1!).toBeDefined();
      expect(post1!.value.author.value.org).toBeDefined();
      expect(post1!.value.author.value.org.value).toBeDefined();
      expect(post1!.value.author.value.org.value.id.value).toBe(orgId1);
      expect(post1!.value.author.value.org.value.name.value).toBe("acme");

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the org name
      const updatedOrgName = "Acme Corp Updated";
      await storage.update(deepSchema.orgs, orgId1, {
        name: updatedOrgName,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutations were received for posts by users from that org
      // postId1 and postId2 are by users from orgId1
      expect(subscriptionCallbacks.length).toBeGreaterThan(0);
      const org1Mutation = subscriptionCallbacks.find(
        (cb) => cb.mutation.resourceId === orgId1
      );
      expect(org1Mutation).toBeDefined();
      expect(org1Mutation!).toBeDefined();
      expect(org1Mutation!.mutation.procedure).toBe("UPDATE");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to orgs with two-level include (users.posts) and receives notification when nested post is created", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to orgs with users and users.posts included
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
              posts: true,
            },
          },
        },
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 1 org (acme)
      expect(result.data.length).toBe(1);
      const org = result.data[0];
      expect(org.value.name.value).toBe("acme");
      expect(org.value.users.value.length).toBe(2);

      // Verify users have posts included
      org.value.users.value.forEach((user: any) => {
        expect(user.value.posts).toBeDefined();
        expect(user.value.posts.value).toBeDefined();
        expect(Array.isArray(user.value.posts.value)).toBe(true);
      });

      // Verify user1 (John Doe) has 1 post (postId1)
      const user1 = org.value.users.value.find(
        (u: any) => u.value.id.value === userId1
      );
      expect(user1).toBeDefined();
      expect(user1.value.posts.value.length).toBe(1);
      expect(user1.value.posts.value[0].value.id.value).toBe(postId1);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a new post by user1
      const newPostId = generateId();
      const newPostTitle = "New Post by John";
      await storage.insert(deepSchema.posts, {
        id: newPostId,
        title: newPostTitle,
        content: "New content",
        authorId: userId1,
        likes: 0,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the org (because nested post was created)
      expect(subscriptionCallbacks.length).toBeGreaterThan(0);
      const postMutation = subscriptionCallbacks.find(
        (cb) => cb.mutation.resource === "posts"
      );
      expect(postMutation).toBeDefined();
      expect(postMutation!.mutation.resourceId).toBe(newPostId);
      expect(postMutation!.mutation.procedure).toBe("INSERT");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to orgs with three-level include (users.posts.comments) and receives notification when deeply nested comment is created", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to orgs with users.posts.comments included
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
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 1 org
      expect(result.data.length).toBe(1);
      const org = result.data[0];
      expect(org.value.name.value).toBe("acme");

      // Verify nested structure: org -> users -> posts -> comments
      const user1 = org.value.users.value.find(
        (u: any) => u.value.id.value === userId1
      );
      expect(user1).toBeDefined();
      const post1 = user1.value.posts.value.find(
        (p: any) => p.value.id.value === postId1
      );
      expect(post1).toBeDefined();
      expect(post1.value.comments).toBeDefined();
      expect(post1.value.comments.value).toBeDefined();
      expect(Array.isArray(post1.value.comments.value)).toBe(true);
      expect(post1.value.comments.value.length).toBe(2);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a new comment on postId1
      const newCommentId = generateId();
      const newCommentContent = "Deeply nested comment";
      await storage.insert(deepSchema.comments, {
        id: newCommentId,
        content: newCommentContent,
        postId: postId1,
        authorId: userId2,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the org (because deeply nested comment was created)
      expect(subscriptionCallbacks.length).toBeGreaterThan(0);
      const commentMutation = subscriptionCallbacks.find(
        (cb) => cb.mutation.resource === "comments"
      );
      expect(commentMutation).toBeDefined();
      expect(commentMutation!.mutation.resourceId).toBe(newCommentId);
      expect(commentMutation!.mutation.procedure).toBe("INSERT");

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("subscribes to posts with include (author) and receives notification when post author changes", async () => {
      const subscriptionCallbacks: Array<{
        mutation: any;
      }> = [];

      // Subscribe to posts with author included
      const result = await testServer.handleQuery({
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
        testNewEngine: true,
        subscription: (mutation) => {
          subscriptionCallbacks.push({ mutation });
        },
      });

      // Verify initial query returns exactly 4 posts
      expect(result.data.length).toBe(4);

      // Get postId2 which has author userId2
      const post2 = result.data.find((p: any) => p.value.id.value === postId2);
      expect(post2).toBeDefined();
      expect(post2!).toBeDefined();
      expect(post2!.value.author.value.id.value).toBe(userId2);

      // Wait for initial subscription to settle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update the post to change its author
      await storage.update(deepSchema.posts, postId2, {
        authorId: userId1,
      });

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify mutation was received for the post
      expect(subscriptionCallbacks.length).toBe(1);
      expect(subscriptionCallbacks[0].mutation.resource).toBe("posts");
      expect(subscriptionCallbacks[0].mutation.resourceId).toBe(postId2);
      expect(subscriptionCallbacks[0].mutation.procedure).toBe("UPDATE");
      expect(subscriptionCallbacks[0].mutation.payload).toBeDefined();
      expect(subscriptionCallbacks[0].mutation.payload.authorId.value).toBe(
        userId1
      );

      // Clean up subscription
      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });
});
