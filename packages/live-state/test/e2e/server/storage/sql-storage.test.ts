/**
 * End-to-end test suite for SQLStorage using SQLite dialect
 * Tests all storage operations with better-sqlite3
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Selectable } from "kysely";
import {
  createRelations,
  createSchema,
  id,
  number,
  object,
  reference,
  string,
} from "../../../../src/schema";
import { SQLStorage } from "../../../../src/server/storage";
import { generateId } from "../../../../src/core/utils";

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

describe("SQLStorage E2E Tests with SQLite", () => {
  let storage: SQLStorage;
  let db: Database.Database;
  let kyselyDb: Kysely<{ [x: string]: Selectable<any> }>;

  beforeEach(async () => {
    // Create in-memory SQLite database
    db = new Database(":memory:");

    // Create Kysely instance with SQLite dialect
    kyselyDb = new Kysely({
      dialect: new SqliteDialect({
        database: db,
      }),
      log: ["query", "error"],
    });

    // Create SQLStorage with Kysely instance
    storage = new SQLStorage(kyselyDb, testSchema);

    // Initialize storage (creates tables)
    await storage.init(testSchema);
  });

  afterEach(async () => {
    // Clean up: drop all tables
    try {
      await kyselyDb.schema.dropTable("posts_meta").ifExists().execute();
      await kyselyDb.schema.dropTable("posts").ifExists().execute();
      await kyselyDb.schema.dropTable("users_meta").ifExists().execute();
      await kyselyDb.schema.dropTable("users").ifExists().execute();
    } catch (error) {
      // Ignore errors during cleanup
    }

    // Close database connection
    // For SQLite, closing the underlying database is sufficient
    db.close();
  });

  describe("Initialization", () => {
    test("should initialize storage and create tables", async () => {
      // Verify tables exist by querying them
      const usersTable = await kyselyDb
        .selectFrom("users")
        .selectAll()
        .execute();

      const postsTable = await kyselyDb
        .selectFrom("posts")
        .selectAll()
        .execute();

      expect(usersTable).toBeDefined();
      expect(postsTable).toBeDefined();
    });

    test("should create meta tables", async () => {
      // Verify meta tables exist
      const usersMetaTable = await kyselyDb
        .selectFrom("users_meta")
        .selectAll()
        .execute();

      const postsMetaTable = await kyselyDb
        .selectFrom("posts_meta")
        .selectAll()
        .execute();

      expect(usersMetaTable).toBeDefined();
      expect(postsMetaTable).toBeDefined();
    });
  });

  describe("Insert Operations", () => {
    test("should insert a user", async () => {
      const userId = generateId();
      const userData = {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
      };

      const result = await storage.insert(testSchema.users, userData);

      expect(result).toBeDefined();
      expect(result.id).toBe(userId);
      expect(result.name).toBe("John Doe");
      expect(result.email).toBe("john@example.com");
    });

    test("should insert multiple users", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      const user1 = await storage.insert(testSchema.users, {
        id: userId1,
        name: "John Doe",
        email: "john@example.com",
      });

      const user2 = await storage.insert(testSchema.users, {
        id: userId2,
        name: "Jane Smith",
        email: "jane@example.com",
      });

      expect(user1.id).toBe(userId1);
      expect(user2.id).toBe(userId2);

      const allUsers = await storage.find(testSchema.users);
      expect(allUsers.length).toBe(2);
    });

    test("should insert post with reference", async () => {
      const userId = generateId();
      const postId = generateId();

      await storage.insert(testSchema.users, {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
      });

      const post = await storage.insert(testSchema.posts, {
        id: postId,
        title: "Test Post",
        content: "Test Content",
        authorId: userId,
        likes: 0,
      });

      expect(post).toBeDefined();
      expect(post.id).toBe(postId);
      expect(post.title).toBe("Test Post");
      expect(post.authorId).toBe(userId);
    });
  });

  describe("Find Operations", () => {
    test("should find all users", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      await storage.insert(testSchema.users, {
        id: userId1,
        name: "John Doe",
        email: "john@example.com",
      });

      await storage.insert(testSchema.users, {
        id: userId2,
        name: "Jane Smith",
        email: "jane@example.com",
      });

      const users = await storage.find(testSchema.users);

      expect(users.length).toBe(2);
      expect(users.some((u) => u.id === userId1)).toBe(true);
      expect(users.some((u) => u.id === userId2)).toBe(true);
    });

    test("should find user by id", async () => {
      const userId = generateId();

      await storage.insert(testSchema.users, {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
      });

      const user = await storage.findOne(testSchema.users, userId);

      expect(user).toBeDefined();
      expect(user?.id).toBe(userId);
      expect(user?.name).toBe("John Doe");
      expect(user?.email).toBe("john@example.com");
    });

    test("should return undefined for non-existent user", async () => {
      const user = await storage.findOne(testSchema.users, "non-existent-id");

      expect(user).toBeUndefined();
    });

    test("should find users with where clause", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      await storage.insert(testSchema.users, {
        id: userId1,
        name: "John Doe",
        email: "john@example.com",
      });

      await storage.insert(testSchema.users, {
        id: userId2,
        name: "Jane Smith",
        email: "jane@example.com",
      });

      const users = await storage.find(testSchema.users, {
        where: { name: "John Doe" },
      });

      expect(users.length).toBe(1);
      expect(users[0].id).toBe(userId1);
      expect(users[0].name).toBe("John Doe");
    });

    test("should find with limit", async () => {
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

      const users = await storage.find(testSchema.users, {
        limit: 2,
      });

      expect(users.length).toBe(2);
    });

    test("should find with sort", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      await storage.insert(testSchema.users, {
        id: userId1,
        name: "Zebra",
        email: "zebra@example.com",
      });

      await storage.insert(testSchema.users, {
        id: userId2,
        name: "Alpha",
        email: "alpha@example.com",
      });

      const users = await storage.find(testSchema.users, {
        sort: [{ key: "name", direction: "asc" }],
      });

      expect(users.length).toBe(2);
      expect(users[0].name).toBe("Alpha");
      expect(users[1].name).toBe("Zebra");
    });
  });

  describe("Include Operations", () => {
    test("should include one relation", async () => {
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

      const posts = await storage.find(testSchema.posts, {
        include: { author: true },
      });

      expect(posts.length).toBe(1);
      expect(posts[0].author).toBeDefined();
      expect(posts[0].author?.id).toBe(userId);
      expect(posts[0].author?.name).toBe("John Doe");
    });

    test("should include many relation", async () => {
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

      const users = await storage.find(testSchema.users, {
        include: { posts: true },
      });

      expect(users.length).toBe(1);
      expect(users[0].posts).toBeDefined();
      expect(Array.isArray(users[0].posts)).toBe(true);
      expect(users[0].posts?.length).toBe(2);
    });
  });

  describe("Update Operations", () => {
    test("should update user", async () => {
      const userId = generateId();

      await storage.insert(testSchema.users, {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
      });

      const updated = await storage.update(testSchema.users, userId, {
        name: "John Updated",
      });

      expect(updated).toBeDefined();
      expect(updated.name).toBe("John Updated");
      expect(updated.email).toBeUndefined(); // Unchanged fields are not included in the result

      const user = await storage.findOne(testSchema.users, userId);
      expect(user?.name).toBe("John Updated");
    });

    test("should update post likes", async () => {
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

      const updated = await storage.update(testSchema.posts, postId, {
        likes: 10,
      });

      expect(updated.likes).toBe(10);

      const post = await storage.findOne(testSchema.posts, postId);
      expect(post?.likes).toBe(10);
    });
  });

  describe("Transaction Operations", () => {
    test("should commit transaction", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      await storage.transaction(async ({ trx, commit }) => {
        await trx.insert(testSchema.users, {
          id: userId1,
          name: "User 1",
          email: "user1@example.com",
        });

        await trx.insert(testSchema.users, {
          id: userId2,
          name: "User 2",
          email: "user2@example.com",
        });

        await commit();
      });

      const users = await storage.find(testSchema.users);
      expect(users.length).toBe(2);
    });

    test("should rollback transaction", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      try {
        await storage.transaction(async ({ trx, rollback }) => {
          await trx.insert(testSchema.users, {
            id: userId1,
            name: "User 1",
            email: "user1@example.com",
          });

          await rollback();
        });
      } catch (error) {
        // Expected
      }

      const users = await storage.find(testSchema.users);
      expect(users.length).toBe(0);
    });

    test("should handle nested transactions", async () => {
      const userId1 = generateId();
      const userId2 = generateId();

      await storage.transaction(async ({ trx, commit }) => {
        await trx.insert(testSchema.users, {
          id: userId1,
          name: "User 1",
          email: "user1@example.com",
        });

        await trx.transaction(
          async ({ trx: nestedTrx, commit: nestedCommit }) => {
            await nestedTrx.insert(testSchema.users, {
              id: userId2,
              name: "User 2",
              email: "user2@example.com",
            });

            await nestedCommit();
          }
        );

        await commit();
      });

      const users = await storage.find(testSchema.users);
      expect(users.length).toBe(2);
    });
  });

  describe("Complex Queries", () => {
    test("should find posts by author with include", async () => {
      const userId1 = generateId();
      const userId2 = generateId();
      const postId1 = generateId();
      const postId2 = generateId();

      await storage.insert(testSchema.users, {
        id: userId1,
        name: "John Doe",
        email: "john@example.com",
      });

      await storage.insert(testSchema.users, {
        id: userId2,
        name: "Jane Smith",
        email: "jane@example.com",
      });

      await storage.insert(testSchema.posts, {
        id: postId1,
        title: "John's Post",
        content: "Content",
        authorId: userId1,
        likes: 5,
      });

      await storage.insert(testSchema.posts, {
        id: postId2,
        title: "Jane's Post",
        content: "Content",
        authorId: userId2,
        likes: 10,
      });

      const posts = await storage.find(testSchema.posts, {
        where: { authorId: userId1 },
        include: { author: true },
      });

      expect(posts.length).toBe(1);
      expect(posts[0].id).toBe(postId1);
      expect(posts[0].author?.id).toBe(userId1);
    });

    test("should find users with posts sorted by likes", async () => {
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
        content: "Content",
        authorId: userId,
        likes: 10,
      });

      await storage.insert(testSchema.posts, {
        id: postId2,
        title: "Post 2",
        content: "Content",
        authorId: userId,
        likes: 5,
      });

      const posts = await storage.find(testSchema.posts, {
        where: { authorId: userId },
        sort: [{ key: "likes", direction: "desc" }],
      });

      expect(posts.length).toBe(2);
      expect(posts[0].likes).toBe(10);
      expect(posts[1].likes).toBe(5);
    });
  });

  describe("Raw Operations", () => {
    test("should use rawFindById", async () => {
      const userId = generateId();

      await storage.insert(testSchema.users, {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
      });

      const rawUser = await storage.rawFindById(testSchema.users.name, userId);

      expect(rawUser).toBeDefined();
      expect(rawUser?.value.id.value).toBe(userId);
    });

    test("should use rawInsert", async () => {
      const userId = generateId();

      const result = await storage.rawInsert(testSchema.users.name, userId, {
        value: {
          id: { value: userId },
          name: {
            value: "John Doe",
            _meta: { timestamp: new Date().toISOString() },
          },
          email: {
            value: "john@example.com",
            _meta: { timestamp: new Date().toISOString() },
          },
        },
      });

      expect(result.data).toBeDefined();
      expect(result.data.value.id.value).toBe(userId);
      expect(result.acceptedValues).toBeDefined();
    });

    test("should use rawUpdate", async () => {
      const userId = generateId();

      await storage.insert(testSchema.users, {
        id: userId,
        name: "John Doe",
        email: "john@example.com",
      });

      const result = await storage.rawUpdate(testSchema.users.name, userId, {
        value: {
          name: {
            value: "John Updated",
            _meta: { timestamp: new Date().toISOString() },
          },
        },
      });

      expect(result.data).toBeDefined();
      expect(result.data.value.name.value).toBe("John Updated");
      expect(result.acceptedValues).toBeDefined();
    });
  });
});
