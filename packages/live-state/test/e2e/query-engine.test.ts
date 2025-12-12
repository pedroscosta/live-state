/**
 * End-to-end test for query engine functional requirements
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
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId3);
      expect(result.data[0].value.likes.value).toBe(15);
    });

    test("filters results by relation field conditions", async () => {
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
              name: "John Doe",
            },
          },
        },
        testNewEngine: true,
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);
    });

    test("filters results by nested relation field conditions", async () => {
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
                name: "acme",
              },
            },
          },
        },
        testNewEngine: true,
      });

      expect(result.data.length).toBe(2);
      const returnedPostIds = result.data.map((p: any) => p.value.id.value);
      expect(returnedPostIds).toContain(postId1);
      expect(returnedPostIds).toContain(postId2);
    });

    test("filters results with combined conditions using $and operator", async () => {
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
                  name: "John Doe",
                },
              },
            ],
          },
        },
        testNewEngine: true,
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0].value.id.value).toBe(postId1);
      expect(result.data[0].value.likes.value).toBe(10);
    });

    test("filters results with $in operator", async () => {
      const result = await testServer.handleQuery({
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
        testNewEngine: true,
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
      expect(mutations[0].procedure).toBe("INSERT");
      expect(mutations[0].payload.title.value).toBe(newPostTitle);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers only when inserted object matches where clause", async () => {
      const mutations: any[] = [];

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
                name: "acme",
              },
            },
          },
        },
        testNewEngine: true,
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
      expect(mutations[0].procedure).toBe("UPDATE");
      expect(mutations[0].resourceId).toBe(postId1);
      expect(mutations[0].payload.title.value).toBe(updatedTitle);
      expect(mutations[0].payload.likes.value).toBe(updatedLikes);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when object transitions from non-matching to matching", async () => {
      const mutations: any[] = [];

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
      expect(mutations[0].procedure).toBe("INSERT");
      expect(mutations[0].resourceId).toBe(postId2);
      expect(mutations[0].payload.likes.value).toBe(15);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when object transitions from matching to non-matching", async () => {
      const mutations: any[] = [];

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
      expect(mutations[0].procedure).toBe("UPDATE");
      expect(mutations[0].resourceId).toBe(postId3);
      expect(mutations[0].payload.likes.value).toBe(5);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("handles object transitioning between matching and non-matching states", async () => {
      const mutations: any[] = [];

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
      expect(mutations[0].procedure).toBe("UPDATE");
      expect(mutations[0].payload.likes.value).toBe(5);

      // Transition 2: Non-matching -> Matching
      await storage.update(deepSchema.posts, postId3, {
        likes: 15,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(2);
      expect(mutations[1].procedure).toBe("INSERT");
      expect(mutations[1].payload.likes.value).toBe(15);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when relation-based filter is affected by author change", async () => {
      const mutations: any[] = [];

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
              name: "John Doe",
            },
          },
        },
        testNewEngine: true,
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
      expect(mutations[0].procedure).toBe("UPDATE");
      expect(mutations[0].payload.authorId.value).toBe(userId2);

      // Change post author back to John Doe (matches again)
      await storage.update(deepSchema.posts, postId1, {
        authorId: userId1,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mutations.length).toBe(2);
      expect(mutations[1].procedure).toBe("INSERT");
      expect(mutations[1].payload.authorId.value).toBe(userId1);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("handles multiple subscriptions with different filters correctly", async () => {
      const query1Mutations: any[] = [];
      const query2Mutations: any[] = [];

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
          query1Mutations.push(mutation);
        },
      });

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
      expect(query1Mutations[0].procedure).toBe("UPDATE");
      expect(query2Mutations.length).toBe(0);

      // Update postId3 to likes = 25 (matches both)
      await storage.update(deepSchema.posts, postId3, {
        likes: 25,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(query1Mutations.length).toBe(2);
      expect(query1Mutations[1].procedure).toBe("UPDATE");
      expect(query2Mutations.length).toBe(1);
      expect(query2Mutations[0].procedure).toBe("INSERT");

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
      expect(mutations[0].procedure).toBe("INSERT");

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when included relation object is updated", async () => {
      const mutations: any[] = [];

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
      expect(mutations[0].procedure).toBe("UPDATE");

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when deeply nested included relation is updated", async () => {
      const mutations: any[] = [];

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
      expect(orgMutation!.procedure).toBe("UPDATE");

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });
  });

  describe("Objects Moving In and Out of Query Scope", () => {
    test("notifies subscribers when object moves into scope via relation change", async () => {
      const mutations: any[] = [];

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
      expect(postMutation!.procedure).toBe("INSERT");
      expect(postMutation!.payload.authorId.value).toBe(userId1);

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("notifies subscribers when object moves out of scope via relation change", async () => {
      const mutations: any[] = [];

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
      expect(postMutation!.procedure).toBe("UPDATE");
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
      expect(postMutation!.procedure).toBe("INSERT");

      // Should receive INSERTs for all comments on the post
      for (const commentId of post3CommentIds) {
        const commentMutation = mutations.find(
          (m) => m.resource === "comments" && m.resourceId === commentId
        );
        expect(commentMutation).toBeDefined();
        expect(commentMutation!.procedure).toBe("INSERT");
        expect(commentMutation!.payload.postId.value).toBe(postId3);
      }

      if (result.unsubscribe) {
        result.unsubscribe();
      }
    });

    test("handles nested relation changes affecting query scope", async () => {
      const mutations: any[] = [];

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
      expect(commentMutation!.procedure).toBe("UPDATE");
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
});
