/**
 * End-to-end coverage of the common querying use cases the library supports.
 *
 * Runs against an in-memory SQLite database through the server DB
 * (`createServerDB`), so each test exercises the QueryBuilder -> QueryEngine ->
 * SQLStorage path directly without any client/transport. Use cases we do NOT
 * support yet are stubbed with `test.todo` so the gaps stay visible and become
 * the spec when they're implemented.
 */

import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Selectable } from "kysely";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createRelations,
  createSchema,
  id,
  number,
  object,
  reference,
  string,
} from "../../src/schema";
import {
  createServerDB,
  type ServerDB,
  SQLStorage,
} from "../../src/server/storage";

const org = object("orgs", {
  id: id(),
  name: string(),
});

const user = object("users", {
  id: id(),
  name: string(),
  email: string(),
  role: string(),
  age: number(),
  bio: string().nullable(),
  orgId: reference("orgs.id"),
});

const post = object("posts", {
  id: id(),
  title: string(),
  content: string(),
  authorId: reference("users.id"),
  status: string(),
  likes: number(),
  createdAt: number(),
});

const orgRelations = createRelations(org, ({ many }) => ({
  users: many(user, "orgId"),
}));

const userRelations = createRelations(user, ({ one, many }) => ({
  org: one(org, "orgId"),
  posts: many(post, "authorId"),
}));

const postRelations = createRelations(post, ({ one }) => ({
  author: one(user, "authorId"),
}));

const testSchema = createSchema({
  orgs: org,
  users: user,
  posts: post,
  orgRelations,
  userRelations,
  postRelations,
});

describe("Query Use Cases (server DB + SQLite)", () => {
  let storage: SQLStorage;
  let sqliteDb: Database.Database;
  let kyselyDb: Kysely<{ [x: string]: Selectable<unknown> }>;
  let db: ServerDB<typeof testSchema>;

  // Stable ids so assertions can reference specific rows.
  const acme = "org-acme";
  const globex = "org-globex";
  const alice = "user-alice"; // admin, 35, acme, has bio
  const bob = "user-bob"; // member, 28, globex, null bio
  const carol = "user-carol"; // guest, 42, globex, has bio, no posts

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");

    kyselyDb = new Kysely({
      dialect: new SqliteDialect({ database: sqliteDb }),
    });

    storage = new SQLStorage(kyselyDb, testSchema);
    await storage.init(testSchema);

    db = createServerDB(storage, testSchema);

    // Seed orgs.
    await db.orgs.insert({ id: acme, name: "acme" });
    await db.orgs.insert({ id: globex, name: "globex" });

    // Seed users. `bio` is nullable; bob's is null on purpose.
    await db.users.insert({
      id: alice,
      name: "Alice",
      email: "alice@example.com",
      role: "admin",
      age: 35,
      bio: "founder",
      orgId: acme,
    });
    await db.users.insert({
      id: bob,
      name: "Bob",
      email: "bob@example.com",
      role: "member",
      age: 28,
      bio: null,
      orgId: globex,
    });
    await db.users.insert({
      id: carol,
      name: "Carol",
      email: "carol@example.com",
      role: "guest",
      age: 42,
      bio: "lurker",
      orgId: globex,
    });

    // Seed posts. likes/createdAt chosen to make ordering + ranges meaningful.
    await db.posts.insert({
      id: "post-1",
      title: "Alpha",
      content: "first",
      authorId: alice,
      status: "published",
      likes: 30,
      createdAt: 1000,
    });
    await db.posts.insert({
      id: "post-2",
      title: "Beta",
      content: "second",
      authorId: alice,
      status: "draft",
      likes: 5,
      createdAt: 2000,
    });
    await db.posts.insert({
      id: "post-3",
      title: "Gamma",
      content: "third",
      authorId: bob,
      status: "published",
      likes: 15,
      createdAt: 3000,
    });
    await db.posts.insert({
      id: "post-4",
      title: "Delta",
      content: "fourth",
      authorId: bob,
      status: "archived",
      likes: 50,
      createdAt: 4000,
    });
  });

  afterEach(async () => {
    if (kyselyDb) await kyselyDb.destroy();
    if (sqliteDb) sqliteDb.close();
  });

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  // ---------------------------------------------------------------------------
  // Fetching
  // ---------------------------------------------------------------------------
  describe("fetching", () => {
    test("list all rows in a collection", async () => {
      const users = await db.users.get();
      expect(ids(users)).toEqual([alice, bob, carol].sort());
    });

    test("get one by id returns a single object", async () => {
      const user = await db.users.one(alice).get();
      expect(user?.id).toBe(alice);
      expect(user?.name).toBe("Alice");
    });

    test("get one by id returns undefined when missing", async () => {
      const user = await db.users.one("does-not-exist").get();
      expect(user).toBeUndefined();
    });

    test("first() returns the first row matching a filter", async () => {
      const admin = await db.users.first({ role: "admin" }).get();
      expect(admin?.id).toBe(alice);
    });
  });

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------
  describe("filtering", () => {
    test("equality on a field", async () => {
      const published = await db.posts.where({ status: "published" }).get();
      expect(ids(published)).toEqual(["post-1", "post-3"]);
    });

    test("$in membership", async () => {
      const rows = await db.posts
        .where({ status: { $in: ["draft", "archived"] } })
        .get();
      expect(ids(rows)).toEqual(["post-2", "post-4"]);
    });

    test("$not negation", async () => {
      const rows = await db.posts
        .where({ status: { $not: "published" } })
        .get();
      expect(ids(rows)).toEqual(["post-2", "post-4"]);
    });

    test("$not with $in (not in)", async () => {
      const rows = await db.posts
        .where({ status: { $not: { $in: ["draft", "archived"] } } })
        .get();
      expect(ids(rows)).toEqual(["post-1", "post-3"]);
    });

    test("explicit $eq", async () => {
      const rows = await db.posts.where({ status: { $eq: "draft" } }).get();
      expect(ids(rows)).toEqual(["post-2"]);
    });

    test("numeric comparison $gt", async () => {
      const rows = await db.posts.where({ likes: { $gt: 15 } }).get();
      expect(ids(rows)).toEqual(["post-1", "post-4"]);
    });

    test("numeric comparison $lt", async () => {
      const rows = await db.posts.where({ likes: { $lt: 15 } }).get();
      expect(ids(rows)).toEqual(["post-2"]);
    });

    test("numeric comparison $gte / $lte boundaries", async () => {
      const gte = await db.posts.where({ likes: { $gte: 15 } }).get();
      expect(ids(gte)).toEqual(["post-1", "post-3", "post-4"]);

      const lte = await db.posts.where({ likes: { $lte: 15 } }).get();
      expect(ids(lte)).toEqual(["post-2", "post-3"]);
    });

    test("range via $and (two bounds on one field)", async () => {
      const rows = await db.posts
        .where({ $and: [{ likes: { $gte: 10 } }, { likes: { $lte: 40 } }] })
        .get();
      expect(ids(rows)).toEqual(["post-1", "post-3"]);
    });

    test("$or combination", async () => {
      const rows = await db.posts
        .where({ $or: [{ status: "draft" }, { likes: { $gt: 40 } }] })
        .get();
      expect(ids(rows)).toEqual(["post-2", "post-4"]);
    });

    test("filter by null field (IS NULL)", async () => {
      const rows = await db.users.where({ bio: null }).get();
      expect(ids(rows)).toEqual([bob]);
    });

    test("filter by non-null field ($not: null -> IS NOT NULL)", async () => {
      const rows = await db.users.where({ bio: { $not: null } }).get();
      expect(ids(rows)).toEqual([alice, carol].sort());
    });

    test("filter by related entity field on a one relation", async () => {
      const rows = await db.posts.where({ author: { role: "admin" } }).get();
      expect(ids(rows)).toEqual(["post-1", "post-2"]);
    });

    test("filter by a many relation selects the right parents", async () => {
      // Users that have at least one published post. Carol has no posts.
      // NOTE: filtering by a many relation currently duplicates the parent row
      // once per matching child (it joins AND EXISTS-subqueries), so we dedupe
      // here. See the "duplicate parent rows" todo below.
      const rows = await db.users
        .where({ posts: { status: "published" } })
        .get();
      const unique = Array.from(new Set(rows.map((r) => r.id))).sort();
      expect(unique).toEqual([alice, bob].sort());
    });

    test("filter through a multi-level relation (post -> author -> org)", async () => {
      const acmePosts = await db.posts
        .where({ author: { org: { name: "acme" } } })
        .get();
      expect(ids(acmePosts)).toEqual(["post-1", "post-2"]);

      const globexPosts = await db.posts
        .where({ author: { org: { name: "globex" } } })
        .get();
      expect(ids(globexPosts)).toEqual(["post-3", "post-4"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Sorting & limiting
  // ---------------------------------------------------------------------------
  describe("sorting and limiting", () => {
    test("orderBy ascending", async () => {
      const rows = await db.posts.orderBy("likes", "asc").get();
      expect(rows.map((r) => r.id)).toEqual([
        "post-2",
        "post-3",
        "post-1",
        "post-4",
      ]);
    });

    test("orderBy descending", async () => {
      const rows = await db.posts.orderBy("likes", "desc").get();
      expect(rows.map((r) => r.id)).toEqual([
        "post-4",
        "post-1",
        "post-3",
        "post-2",
      ]);
    });

    test("multi-key orderBy", async () => {
      const rows = await db.posts
        .orderBy("status", "asc")
        .orderBy("createdAt", "desc")
        .get();
      // status asc: archived, draft, then the two published ordered by createdAt desc
      expect(rows.map((r) => r.id)).toEqual([
        "post-4",
        "post-2",
        "post-3",
        "post-1",
      ]);
    });

    test("limit caps the result count", async () => {
      const rows = await db.posts.orderBy("createdAt", "asc").limit(2).get();
      expect(rows.map((r) => r.id)).toEqual(["post-1", "post-2"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Relations (includes)
  // ---------------------------------------------------------------------------
  describe("includes", () => {
    test("shallow include of a one relation", async () => {
      const rows = await db.posts
        .where({ id: "post-1" })
        .include({ author: true })
        .get();
      expect(rows[0].author?.id).toBe(alice);
      expect(rows[0].author?.name).toBe("Alice");
    });

    test("shallow include of a many relation", async () => {
      const rows = await db.users
        .where({ id: alice })
        .include({ posts: true })
        .get();
      expect(ids(rows[0].posts ?? [])).toEqual(["post-1", "post-2"]);
    });

    test("nested include (post -> author -> posts)", async () => {
      const rows = await db.posts
        .where({ id: "post-3" })
        .include({ author: { include: { posts: true } } })
        .get();
      expect(rows[0].author?.id).toBe(bob);
      expect(ids(rows[0].author?.posts ?? [])).toEqual(["post-3", "post-4"]);
    });

    test("sub-query include: filter + sort + limit on a relation", async () => {
      const rows = await db.users
        .where({ id: bob })
        .include({
          posts: {
            where: { status: "published" },
            orderBy: [{ key: "likes", direction: "desc" }],
            limit: 5,
          },
        })
        .get();
      expect(ids(rows[0].posts ?? [])).toEqual(["post-3"]);
    });

    test("multiple sibling includes in one query (one + many)", async () => {
      const rows = await db.users
        .where({ id: alice })
        .include({ org: true, posts: true })
        .get();
      expect(rows[0].org?.id).toBe(acme);
      expect(rows[0].org?.name).toBe("acme");
      expect(ids(rows[0].posts ?? [])).toEqual(["post-1", "post-2"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Deep / relation-scoped operations (operations applied to included rows)
  // ---------------------------------------------------------------------------
  describe("deep operations", () => {
    test("deep sort: order a relation's items (e.g. thread -> messages by date)", async () => {
      // alice has post-1 (createdAt 1000) and post-2 (createdAt 2000).
      const asc = await db.users
        .where({ id: alice })
        .include({
          posts: { orderBy: [{ key: "createdAt", direction: "asc" }] },
        })
        .get();
      expect((asc[0].posts ?? []).map((p) => p.id)).toEqual([
        "post-1",
        "post-2",
      ]);

      const desc = await db.users
        .where({ id: alice })
        .include({
          posts: { orderBy: [{ key: "createdAt", direction: "desc" }] },
        })
        .get();
      expect((desc[0].posts ?? []).map((p) => p.id)).toEqual([
        "post-2",
        "post-1",
      ]);
    });

    test("deep filter: filter a relation's items independently of the parent", async () => {
      const rows = await db.users
        .where({ id: alice })
        .include({ posts: { where: { status: "published" } } })
        .get();
      expect(ids(rows[0].posts ?? [])).toEqual(["post-1"]);
    });

    test("deep limit + sort: top-N per parent (highest-liked post per author)", async () => {
      const rows = await db.users
        .where({ id: { $in: [alice, bob] } })
        .include({
          posts: { orderBy: [{ key: "likes", direction: "desc" }], limit: 1 },
        })
        .get();
      const byUser = Object.fromEntries(
        rows.map((u) => [u.id, (u.posts ?? []).map((p) => p.id)])
      );
      // alice: post-1(30) > post-2(5); bob: post-4(50) > post-3(15)
      expect(byUser[alice]).toEqual(["post-1"]);
      expect(byUser[bob]).toEqual(["post-4"]);
    });

    test("deep nesting with per-level options", async () => {
      const rows = await db.orgs
        .where({ id: globex })
        .include({
          users: {
            orderBy: [{ key: "age", direction: "asc" }],
            include: {
              posts: { orderBy: [{ key: "likes", direction: "desc" }] },
            },
          },
        })
        .get();
      // globex users by age asc: bob(28), carol(42)
      expect((rows[0].users ?? []).map((u) => u.id)).toEqual([bob, carol]);
      const bobRow = (rows[0].users ?? []).find((u) => u.id === bob);
      expect((bobRow?.posts ?? []).map((p) => p.id)).toEqual([
        "post-4",
        "post-3",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Combined real-world query
  // ---------------------------------------------------------------------------
  describe("combined", () => {
    test("where + relational filter + include + orderBy + limit", async () => {
      const rows = await db.posts
        .where({
          status: "published",
          author: { role: { $in: ["admin", "member"] } },
        })
        .include({ author: true })
        .orderBy("likes", "desc")
        .limit(10)
        .get();

      expect(rows.map((r) => r.id)).toEqual(["post-1", "post-3"]);
      expect(rows[0].author?.id).toBe(alice);
      expect(rows[1].author?.id).toBe(bob);
    });
  });

  // ---------------------------------------------------------------------------
  // Not supported yet — stubbed so the gaps stay visible.
  // ---------------------------------------------------------------------------
  describe("not yet supported", () => {
    // No `offset`/cursor in RawQueryRequest or QueryBuilder — only `limit`.
    test.todo("offset / cursor pagination (page beyond the first N rows)");

    // No $like / $ilike / contains operator in WhereClause or SQL builder.
    test.todo(
      "text search: substring / case-insensitive match ($like, contains)"
    );

    // QueryEngine returns rows only; no count/sum/avg or groupBy aggregation.
    test.todo("aggregations: count / sum / avg");
    test.todo("groupBy with aggregate selection");

    // get() always selects all fields (+ _meta); no projection / field picking.
    test.todo("field projection (select a subset of columns)");

    // innerApplyWhere is an if/else chain: only one operator per field object
    // wins, so { likes: { $gte, $lte } } silently drops $lte. Use $and instead.
    test.todo("multiple comparison operators inline on one field without $and");

    // applyWhere (in-memory client matching) only compares numbers for
    // $gt/$gte/$lt/$lte; Date fields are typed but fail at runtime there.
    test.todo("Date range filters in the in-memory query engine");

    // --- ordering gaps ---

    // orderBy(key) only accepts keyof the collection's own fields, so you
    // cannot sort by a related field, e.g. posts ordered by author.name.
    test.todo("orderBy on a related/nested field (posts by author.name)");

    // No way to sort by an aggregate, e.g. users by their post count, or
    // threads by their most-recent message date.
    test.todo("orderBy by an aggregate / relation (users by post count)");

    // orderBy takes only a direction; no NULLS FIRST / NULLS LAST control.
    test.todo("NULLS FIRST / NULLS LAST ordering control");

    // --- deep / relation-scoped gaps ---

    // Sub-query includes support limit but not offset/cursor, so you cannot
    // paginate a relation beyond its first N rows (e.g. page 2 of messages).
    test.todo("deep pagination: offset / cursor on an included relation");

    // No aggregate over a relation (count/sum of children per parent) without
    // fetching and reducing all children client-side.
    test.todo("deep aggregation: count/sum of children per parent");

    // Filtering by a many relation returns one parent row per matching child
    // (join + EXISTS), so parents are duplicated and must be deduped by hand.
    test.todo("deduplicate parent rows when filtering by a many relation");
  });
});
