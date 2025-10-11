import {
  createRelations,
  createSchema,
  id,
  object,
  reference,
  string,
  number,
  boolean,
  timestamp,
} from "../../src/schema";
import { createClient } from "../../src/client";
import { createClient as createFetchClient } from "../../src/client/fetch";
import { router as createRouter, routeFactory } from "../../src/server/router";
import { describe, expectTypeOf, test } from "vitest";
import { z } from "zod";

/*
 * Basic schema and routes
 */

const user = object("users", {
  id: id(),
  name: string(),
});

const post = object("posts", {
  id: id(),
  title: string(),
  authorId: reference("users.id"),
});

const comment = object("comments", {
  id: id(),
  content: string(),
  postId: reference("posts.id"),
});

const userRelations = createRelations(user, ({ many }) => ({
  posts: many(post, "authorId"),
  comments: many(comment, "postId"),
}));

const postRelations = createRelations(post, ({ one, many }) => ({
  user: one(user, "authorId"),
  comments: many(comment, "postId"),
}));

const commentRelations = createRelations(comment, ({ one }) => ({
  post: one(post, "postId"),
}));

const schema = createSchema({
  user,
  post,
  comment,
  userRelations,
  postRelations,
  commentRelations,
});

const publicRoute = routeFactory();

const router = createRouter({
  schema,
  routes: {
    users: publicRoute.collectionRoute(schema.users),
    posts: publicRoute.collectionRoute(schema.posts),
    comments: publicRoute.collectionRoute(schema.comments),
  },
});

const {
  store: { query, mutate },
} = createClient<typeof router>({
  url: "ws://localhost:5001/ws",
  schema,
  storage: false,
});

describe("websocket client", () => {
  test("should infer basic query types", () => {
    const userQuery = query.users.get;
    const postQuery = query.posts.get;
    const commentQuery = query.comments.get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      {
        id: string;
        name: string;
      }[]
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      {
        id: string;
        title: string;
        authorId: string;
      }[]
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      {
        id: string;
        content: string;
        postId: string;
      }[]
    >();
  });

  test("should infer basic query types with include", () => {
    const userQuery = query.users.include({
      comments: true,
      posts: false,
    }).get;

    const postQuery = query.posts.include({
      user: true,
      comments: true,
    }).get;

    const commentQuery = query.comments.include({
      post: true,
    }).get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      {
        id: string;
        name: string;
        comments: { id: string; content: string; postId: string }[];
      }[]
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      {
        id: string;
        title: string;
        authorId: string;
        user: { id: string; name: string };
        comments: { id: string; content: string; postId: string }[];
      }[]
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      {
        id: string;
        content: string;
        postId: string;
        post: { id: string; title: string; authorId: string };
      }[]
    >();
  });

  test("should infer insert types", () => {
    const userMutate = mutate.users.insert;
    const postMutate = mutate.posts.insert;
    const commentMutate = mutate.comments.insert;

    expectTypeOf(userMutate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; name: string }>();
    expectTypeOf(postMutate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; title: string; authorId: string }>();
    expectTypeOf(commentMutate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; content: string; postId: string }>();
  });

  test("should infer update types", () => {
    const userMutate = mutate.users.update;
    const postMutate = mutate.posts.update;
    const commentMutate = mutate.comments.update;

    expectTypeOf(userMutate).parameter(1).toEqualTypeOf<{ name?: string }>();
    expectTypeOf(postMutate)
      .parameter(1)
      .toEqualTypeOf<{ title?: string; authorId?: string }>();
    expectTypeOf(commentMutate)
      .parameter(1)
      .toEqualTypeOf<{ content?: string; postId?: string }>();
  });
});

/*
 * Complex schemas with nullable, default values, and various combinations
 */

const complexUser = object("complexUsers", {
  id: id(),
  name: string(),
  email: string().nullable(),
  age: number().nullable(),
  isActive: boolean().default(true),
  score: number().default(0),
  createdAt: timestamp().default(new Date()),
  updatedAt: timestamp().nullable(),
  bio: string().default("No bio provided").nullable(),
  tags: string().nullable(),
});

const complexPost = object("complexPosts", {
  id: id(),
  title: string(),
  content: string().nullable(),
  authorId: reference("complexUsers.id"),
  published: boolean().default(false),
  views: number().default(0),
  rating: number().nullable(),
  publishedAt: timestamp().nullable(),
  createdAt: timestamp().default(new Date()),
  updatedAt: timestamp().nullable(),
  metadata: string().nullable(),
});

const complexComment = object("complexComments", {
  id: id(),
  content: string(),
  postId: reference("complexPosts.id"),
  authorId: reference("complexUsers.id"),
  isApproved: boolean().default(false),
  likes: number().default(0),
  createdAt: timestamp().default(new Date()),
  updatedAt: timestamp().nullable(),
  parentId: reference("complexComments.id").nullable(),
});

const complexUserRelations = createRelations(complexUser, ({ many }) => ({
  posts: many(complexPost, "authorId"),
  comments: many(complexComment, "authorId"),
}));

const complexPostRelations = createRelations(complexPost, ({ one, many }) => ({
  author: one(complexUser, "authorId"),
  comments: many(complexComment, "postId"),
}));

const complexCommentRelations = createRelations(
  complexComment,
  ({ one, many }) => {
    const ret = {
      post: one(complexPost, "postId"),
      author: one(complexUser, "authorId"),
      parent: one(complexComment, "parentId", false),
      replies: many(complexComment, "parentId"),
    };
    return ret;
  }
);

const complexCommentRelations2 = createRelations(
  complexComment,
  ({ one, many }) => ({
    post: one(complexPost, "postId"),
    author: one(complexUser, "authorId"),
    parent: one(complexComment, "parentId", false),
    replies: many(complexComment, "parentId"),
  })
);

const complexSchema = createSchema({
  complexUser,
  complexPost,
  complexComment,
  complexUserRelations,
  complexPostRelations,
  complexCommentRelations,
});

const complexRouter = createRouter({
  schema: complexSchema,
  routes: {
    complexUsers: publicRoute.collectionRoute(complexSchema.complexUsers),
    complexPosts: publicRoute.collectionRoute(complexSchema.complexPosts),
    complexComments: publicRoute.collectionRoute(complexSchema.complexComments),
  },
});

const {
  store: { query: complexQuery, mutate: complexMutate },
} = createClient<typeof complexRouter>({
  url: "ws://localhost:5001/ws",
  schema: complexSchema,
  storage: false,
});

describe("complex websocket client", () => {
  test("should infer complex query types with nullable and default fields", () => {
    const userQuery = complexQuery.complexUsers.get;
    const postQuery = complexQuery.complexPosts.get;
    const commentQuery = complexQuery.complexComments.get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      {
        id: string;
        name: string;
        email: string | null;
        age: number | null;
        isActive: boolean;
        score: number;
        createdAt: Date;
        updatedAt: Date | null;
        bio: string | null;
        tags: string | null;
      }[]
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      {
        id: string;
        title: string;
        content: string | null;
        authorId: string;
        published: boolean;
        views: number;
        rating: number | null;
        publishedAt: Date | null;
        createdAt: Date;
        updatedAt: Date | null;
        metadata: string | null;
      }[]
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      {
        id: string;
        content: string;
        postId: string;
        authorId: string;
        isApproved: boolean;
        likes: number;
        createdAt: Date;
        updatedAt: Date | null;
        parentId: string | null;
      }[]
    >();
  });

  test("should infer complex query types with include", () => {
    const userQuery = complexQuery.complexUsers.include({
      posts: true,
      comments: false,
    }).get;

    const postQuery = complexQuery.complexPosts.include({
      author: true,
      comments: true,
    }).get;

    const commentQuery = complexQuery.complexComments.include({
      post: true,
      author: true,
      parent: true,
      replies: true,
    }).get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      {
        id: string;
        name: string;
        email: string | null;
        age: number | null;
        isActive: boolean;
        score: number;
        createdAt: Date;
        updatedAt: Date | null;
        bio: string | null;
        tags: string | null;
        posts: {
          id: string;
          title: string;
          content: string | null;
          authorId: string;
          published: boolean;
          views: number;
          rating: number | null;
          publishedAt: Date | null;
          createdAt: Date;
          updatedAt: Date | null;
          metadata: string | null;
        }[];
      }[]
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      {
        id: string;
        title: string;
        content: string | null;
        authorId: string;
        published: boolean;
        views: number;
        rating: number | null;
        publishedAt: Date | null;
        createdAt: Date;
        updatedAt: Date | null;
        metadata: string | null;
        author: {
          id: string;
          name: string;
          email: string | null;
          age: number | null;
          isActive: boolean;
          score: number;
          createdAt: Date;
          updatedAt: Date | null;
          bio: string | null;
          tags: string | null;
        };
        comments: {
          id: string;
          content: string;
          postId: string;
          authorId: string;
          isApproved: boolean;
          likes: number;
          createdAt: Date;
          updatedAt: Date | null;
          parentId: string | null;
        }[];
      }[]
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      {
        id: string;
        content: string;
        postId: string;
        authorId: string;
        isApproved: boolean;
        likes: number;
        createdAt: Date;
        updatedAt: Date | null;
        parentId: string | null;
        post: {
          id: string;
          title: string;
          content: string | null;
          authorId: string;
          published: boolean;
          views: number;
          rating: number | null;
          publishedAt: Date | null;
          createdAt: Date;
          updatedAt: Date | null;
          metadata: string | null;
        };
        author: {
          id: string;
          name: string;
          email: string | null;
          age: number | null;
          isActive: boolean;
          score: number;
          createdAt: Date;
          updatedAt: Date | null;
          bio: string | null;
          tags: string | null;
        };
        parent: {
          id: string;
          content: string;
          postId: string;
          authorId: string;
          isApproved: boolean;
          likes: number;
          createdAt: Date;
          updatedAt: Date | null;
          parentId: string | null;
        } | null;
        replies: {
          id: string;
          content: string;
          postId: string;
          authorId: string;
          isApproved: boolean;
          likes: number;
          createdAt: Date;
          updatedAt: Date | null;
          parentId: string | null;
        }[];
      }[]
    >();
  });

  test("should infer complex insert types with defaults", () => {
    const userMutate = complexMutate.complexUsers.insert;
    const postMutate = complexMutate.complexPosts.insert;
    const commentMutate = complexMutate.complexComments.insert;

    expectTypeOf(userMutate).parameter(0).toEqualTypeOf<{
      id: string;
      name: string;
      email: string | null;
      age: number | null;
      updatedAt: Date | null;
      tags: string | null;
      isActive?: boolean | undefined;
      score?: number | undefined;
      createdAt?: Date | undefined;
      bio?: string | null | undefined;
    }>();

    expectTypeOf(postMutate).parameter(0).toEqualTypeOf<{
      id: string;
      title: string;
      content: string | null;
      authorId: string;
      rating: number | null;
      publishedAt: Date | null;
      updatedAt: Date | null;
      metadata: string | null;
      published?: boolean | undefined;
      views?: number | undefined;
      createdAt?: Date | undefined;
    }>();

    expectTypeOf(commentMutate).parameter(0).toEqualTypeOf<{
      id: string;
      content: string;
      postId: string;
      authorId: string;
      updatedAt: Date | null;
      parentId: string | null;
      isApproved?: boolean | undefined;
      likes?: number | undefined;
      createdAt?: Date | undefined;
    }>();
  });

  test("should infer complex update types", () => {
    const userMutate = complexMutate.complexUsers.update;
    const postMutate = complexMutate.complexPosts.update;
    const commentMutate = complexMutate.complexComments.update;

    expectTypeOf(userMutate).parameter(1).toEqualTypeOf<{
      name?: string;
      email?: string | null;
      age?: number | null;
      isActive?: boolean;
      score?: number;
      createdAt?: Date;
      updatedAt?: Date | null;
      bio?: string | null;
      tags?: string | null;
    }>();

    expectTypeOf(postMutate).parameter(1).toEqualTypeOf<{
      title?: string;
      content?: string | null;
      authorId?: string;
      published?: boolean;
      views?: number;
      rating?: number | null;
      publishedAt?: Date | null;
      createdAt?: Date;
      updatedAt?: Date | null;
      metadata?: string | null;
    }>();

    expectTypeOf(commentMutate).parameter(1).toEqualTypeOf<{
      content?: string;
      postId?: string;
      authorId?: string;
      isApproved?: boolean;
      likes?: number;
      createdAt?: Date;
      updatedAt?: Date | null;
      parentId?: string | null;
    }>();
  });
});

/*
 * Edge cases and combinations
 */

const edgeCaseUser = object("edgeCaseUsers", {
  id: id(),
  // Nullable with default
  nickname: string().default("Anonymous").nullable(),
  // Required field
  email: string(),
  // Nullable without default
  phone: string().nullable(),
  // Default without nullable
  status: string().default("active"),
  // Number with default
  priority: number().default(1),
  // Nullable number
  score: number().nullable(),
  // Boolean with default
  verified: boolean().default(false),
  // Timestamp with default
  lastLogin: timestamp().default(new Date()),
  // Nullable timestamp
  deletedAt: timestamp().nullable(),
});

const edgeCaseSchema = createSchema({
  edgeCaseUser,
});

const edgeCaseRouter = createRouter({
  schema: edgeCaseSchema,
  routes: {
    edgeCaseUsers: publicRoute.collectionRoute(edgeCaseSchema.edgeCaseUsers),
  },
});

const {
  store: { query: edgeCaseQuery, mutate: edgeCaseMutate },
} = createClient<typeof edgeCaseRouter>({
  url: "ws://localhost:5001/ws",
  schema: edgeCaseSchema,
  storage: false,
});

describe("edge cases and combinations", () => {
  test("should handle nullable with default values", () => {
    const userQuery = edgeCaseQuery.edgeCaseUsers.get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      {
        id: string;
        nickname: string | null;
        email: string;
        phone: string | null;
        status: string;
        priority: number;
        score: number | null;
        verified: boolean;
        lastLogin: Date;
        deletedAt: Date | null;
      }[]
    >();
  });

  test("should handle insert types with mixed nullable and default fields", () => {
    const userMutate = edgeCaseMutate.edgeCaseUsers.insert;

    expectTypeOf(userMutate).parameter(0).toEqualTypeOf<{
      id: string;
      email: string;
      phone: string | null;
      score: number | null;
      deletedAt: Date | null;
      nickname?: string | null | undefined;
      status?: string | undefined;
      priority?: number | undefined;
      verified?: boolean | undefined;
      lastLogin?: Date | undefined;
    }>();
  });

  test("should handle update types with mixed nullable and default fields", () => {
    const userMutate = edgeCaseMutate.edgeCaseUsers.update;

    expectTypeOf(userMutate).parameter(1).toEqualTypeOf<{
      nickname?: string | null;
      email?: string;
      phone?: string | null;
      status?: string;
      priority?: number;
      score?: number | null;
      verified?: boolean;
      lastLogin?: Date;
      deletedAt?: Date | null;
    }>();
  });
});

/*
 * Fetch client type tests
 */

const fetchClient = createFetchClient<typeof router>({
  url: "http://localhost:3000",
  schema,
  credentials: async () => ({}),
});

describe("fetch client", () => {
  test("should infer basic query types", () => {
    const userQuery = fetchClient.query.users.get;
    const postQuery = fetchClient.query.posts.get;
    const commentQuery = fetchClient.query.comments.get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          name: string;
        }[]
      >
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          title: string;
          authorId: string;
        }[]
      >
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          content: string;
          postId: string;
        }[]
      >
    >();
  });

  test("should infer basic query types with include", () => {
    const userQuery = fetchClient.query.users.include({
      comments: true,
      posts: false,
    }).get;

    const postQuery = fetchClient.query.posts.include({
      user: true,
      comments: true,
    }).get;

    const commentQuery = fetchClient.query.comments.include({
      post: true,
    }).get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          name: string;
          comments: { id: string; content: string; postId: string }[];
        }[]
      >
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          title: string;
          authorId: string;
          user: { id: string; name: string };
          comments: { id: string; content: string; postId: string }[];
        }[]
      >
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          content: string;
          postId: string;
          post: { id: string; title: string; authorId: string };
        }[]
      >
    >();
  });

  test("should infer insert types", () => {
    const userMutate = fetchClient.mutate.users.insert;
    const postMutate = fetchClient.mutate.posts.insert;
    const commentMutate = fetchClient.mutate.comments.insert;

    expectTypeOf(userMutate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; name: string }>();
    expectTypeOf(postMutate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; title: string; authorId: string }>();
    expectTypeOf(commentMutate)
      .parameter(0)
      .toEqualTypeOf<{ id: string; content: string; postId: string }>();
  });

  test("should infer update types", () => {
    const userMutate = fetchClient.mutate.users.update;
    const postMutate = fetchClient.mutate.posts.update;
    const commentMutate = fetchClient.mutate.comments.update;

    expectTypeOf(userMutate).parameter(1).toEqualTypeOf<{ name?: string }>();
    expectTypeOf(postMutate)
      .parameter(1)
      .toEqualTypeOf<{ title?: string; authorId?: string }>();
    expectTypeOf(commentMutate)
      .parameter(1)
      .toEqualTypeOf<{ content?: string; postId?: string }>();
  });

  test("should handle query chaining", () => {
    const chainedQuery = fetchClient.query.users
      .where({ name: "John" })
      .include({ posts: true })
      .limit(10)
      .orderBy("name", "asc").get;

    expectTypeOf(chainedQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          name: string;
          posts: { id: string; title: string; authorId: string }[];
        }[]
      >
    >();
  });

  test("should handle single result queries", () => {
    const singleUserQuery = fetchClient.query.users.one("123").get;
    const firstUserQuery = fetchClient.query.users.first().get;

    expectTypeOf(singleUserQuery).returns.toEqualTypeOf<
      Promise<
        | {
            id: string;
            name: string;
          }
        | undefined
      >
    >();

    expectTypeOf(firstUserQuery).returns.toEqualTypeOf<
      Promise<
        | {
            id: string;
            name: string;
          }
        | undefined
      >
    >();
  });

  test("should handle single result queries with include", () => {
    const singleUserQuery = fetchClient.query.users
      .include({ posts: true })
      .one("123").get;

    expectTypeOf(singleUserQuery).returns.toEqualTypeOf<
      Promise<
        | {
            id: string;
            name: string;
            posts: { id: string; title: string; authorId: string }[];
          }
        | undefined
      >
    >();
  });
});

/*
 * Complex fetch client type tests
 */

const complexFetchClient = createFetchClient<typeof complexRouter>({
  url: "http://localhost:3000",
  schema: complexSchema,
  credentials: async () => ({}),
});

describe("complex fetch client", () => {
  test("should infer complex query types with nullable and default fields", () => {
    const userQuery = complexFetchClient.query.complexUsers.get;
    const postQuery = complexFetchClient.query.complexPosts.get;
    const commentQuery = complexFetchClient.query.complexComments.get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          name: string;
          email: string | null;
          age: number | null;
          isActive: boolean;
          score: number;
          createdAt: Date;
          updatedAt: Date | null;
          bio: string | null;
          tags: string | null;
        }[]
      >
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          title: string;
          content: string | null;
          authorId: string;
          published: boolean;
          views: number;
          rating: number | null;
          publishedAt: Date | null;
          createdAt: Date;
          updatedAt: Date | null;
          metadata: string | null;
        }[]
      >
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          content: string;
          postId: string;
          authorId: string;
          isApproved: boolean;
          likes: number;
          createdAt: Date;
          updatedAt: Date | null;
          parentId: string | null;
        }[]
      >
    >();
  });

  test("should infer complex query types with include", () => {
    const userQuery = complexFetchClient.query.complexUsers.include({
      posts: true,
      comments: false,
    }).get;

    const postQuery = complexFetchClient.query.complexPosts.include({
      author: true,
      comments: true,
    }).get;

    const commentQuery = complexFetchClient.query.complexComments.include({
      post: true,
      author: true,
      parent: true,
      replies: true,
    }).get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          name: string;
          email: string | null;
          age: number | null;
          isActive: boolean;
          score: number;
          createdAt: Date;
          updatedAt: Date | null;
          bio: string | null;
          tags: string | null;
          posts: {
            id: string;
            title: string;
            content: string | null;
            authorId: string;
            published: boolean;
            views: number;
            rating: number | null;
            publishedAt: Date | null;
            createdAt: Date;
            updatedAt: Date | null;
            metadata: string | null;
          }[];
        }[]
      >
    >();

    expectTypeOf(postQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          title: string;
          content: string | null;
          authorId: string;
          published: boolean;
          views: number;
          rating: number | null;
          publishedAt: Date | null;
          createdAt: Date;
          updatedAt: Date | null;
          metadata: string | null;
          author: {
            id: string;
            name: string;
            email: string | null;
            age: number | null;
            isActive: boolean;
            score: number;
            createdAt: Date;
            updatedAt: Date | null;
            bio: string | null;
            tags: string | null;
          };
          comments: {
            id: string;
            content: string;
            postId: string;
            authorId: string;
            isApproved: boolean;
            likes: number;
            createdAt: Date;
            updatedAt: Date | null;
            parentId: string | null;
          }[];
        }[]
      >
    >();

    expectTypeOf(commentQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          content: string;
          postId: string;
          authorId: string;
          isApproved: boolean;
          likes: number;
          createdAt: Date;
          updatedAt: Date | null;
          parentId: string | null;
          post: {
            id: string;
            title: string;
            content: string | null;
            authorId: string;
            published: boolean;
            views: number;
            rating: number | null;
            publishedAt: Date | null;
            createdAt: Date;
            updatedAt: Date | null;
            metadata: string | null;
          };
          author: {
            id: string;
            name: string;
            email: string | null;
            age: number | null;
            isActive: boolean;
            score: number;
            createdAt: Date;
            updatedAt: Date | null;
            bio: string | null;
            tags: string | null;
          };
          parent: {
            id: string;
            content: string;
            postId: string;
            authorId: string;
            isApproved: boolean;
            likes: number;
            createdAt: Date;
            updatedAt: Date | null;
            parentId: string | null;
          } | null;
          replies: {
            id: string;
            content: string;
            postId: string;
            authorId: string;
            isApproved: boolean;
            likes: number;
            createdAt: Date;
            updatedAt: Date | null;
            parentId: string | null;
          }[];
        }[]
      >
    >();
  });

  test("should infer complex insert types with defaults", () => {
    const userMutate = complexFetchClient.mutate.complexUsers.insert;
    const postMutate = complexFetchClient.mutate.complexPosts.insert;
    const commentMutate = complexFetchClient.mutate.complexComments.insert;

    expectTypeOf(userMutate).parameter(0).toEqualTypeOf<{
      id: string;
      name: string;
      email: string | null;
      age: number | null;
      updatedAt: Date | null;
      tags: string | null;
      isActive?: boolean | undefined;
      score?: number | undefined;
      createdAt?: Date | undefined;
      bio?: string | null | undefined;
    }>();

    expectTypeOf(postMutate).parameter(0).toEqualTypeOf<{
      id: string;
      title: string;
      content: string | null;
      authorId: string;
      rating: number | null;
      publishedAt: Date | null;
      updatedAt: Date | null;
      metadata: string | null;
      published?: boolean | undefined;
      views?: number | undefined;
      createdAt?: Date | undefined;
    }>();

    expectTypeOf(commentMutate).parameter(0).toEqualTypeOf<{
      id: string;
      content: string;
      postId: string;
      authorId: string;
      updatedAt: Date | null;
      parentId: string | null;
      isApproved?: boolean | undefined;
      likes?: number | undefined;
      createdAt?: Date | undefined;
    }>();
  });

  test("should infer complex update types", () => {
    const userMutate = complexFetchClient.mutate.complexUsers.update;
    const postMutate = complexFetchClient.mutate.complexPosts.update;
    const commentMutate = complexFetchClient.mutate.complexComments.update;

    expectTypeOf(userMutate).parameter(1).toEqualTypeOf<{
      name?: string;
      email?: string | null;
      age?: number | null;
      isActive?: boolean;
      score?: number;
      createdAt?: Date;
      updatedAt?: Date | null;
      bio?: string | null;
      tags?: string | null;
    }>();

    expectTypeOf(postMutate).parameter(1).toEqualTypeOf<{
      title?: string;
      content?: string | null;
      authorId?: string;
      published?: boolean;
      views?: number;
      rating?: number | null;
      publishedAt?: Date | null;
      createdAt?: Date;
      updatedAt?: Date | null;
      metadata?: string | null;
    }>();

    expectTypeOf(commentMutate).parameter(1).toEqualTypeOf<{
      content?: string;
      postId?: string;
      authorId?: string;
      isApproved?: boolean;
      likes?: number;
      createdAt?: Date;
      updatedAt?: Date | null;
      parentId?: string | null;
    }>();
  });
});

/*
 * Edge cases fetch client type tests
 */

const edgeCaseFetchClient = createFetchClient<typeof edgeCaseRouter>({
  url: "http://localhost:3000",
  schema: edgeCaseSchema,
  credentials: async () => ({}),
});

describe("edge cases fetch client", () => {
  test("should handle nullable with default values", () => {
    const userQuery = edgeCaseFetchClient.query.edgeCaseUsers.get;

    expectTypeOf(userQuery).returns.toEqualTypeOf<
      Promise<
        {
          id: string;
          nickname: string | null;
          email: string;
          phone: string | null;
          status: string;
          priority: number;
          score: number | null;
          verified: boolean;
          lastLogin: Date;
          deletedAt: Date | null;
        }[]
      >
    >();
  });

  test("should handle insert types with mixed nullable and default fields", () => {
    const userMutate = edgeCaseFetchClient.mutate.edgeCaseUsers.insert;

    expectTypeOf(userMutate).parameter(0).toEqualTypeOf<{
      id: string;
      email: string;
      phone: string | null;
      score: number | null;
      deletedAt: Date | null;
      nickname?: string | null | undefined;
      status?: string | undefined;
      priority?: number | undefined;
      verified?: boolean | undefined;
      lastLogin?: Date | undefined;
    }>();
  });

  test("should handle update types with mixed nullable and default fields", () => {
    const userMutate = edgeCaseFetchClient.mutate.edgeCaseUsers.update;

    expectTypeOf(userMutate).parameter(1).toEqualTypeOf<{
      nickname?: string | null;
      email?: string;
      phone?: string | null;
      status?: string;
      priority?: number;
      score?: number | null;
      verified?: boolean;
      lastLogin?: Date;
      deletedAt?: Date | null;
    }>();
  });
});

/*
 * Custom mutations type tests
 */

const customMutationUser = object("customMutationUsers", {
  id: id(),
  name: string(),
  email: string(),
  age: number(),
});

const customMutationPost = object("customMutationPosts", {
  id: id(),
  title: string(),
  content: string(),
  authorId: reference("customMutationUsers.id"),
});

const customMutationSchema = createSchema({
  customMutationUser,
  customMutationPost,
});

const customMutationRouter = createRouter({
  schema: customMutationSchema,
  routes: {
    customMutationUsers: publicRoute
      .collectionRoute(customMutationSchema.customMutationUsers)
      .withMutations(({ mutation }) => ({
        // Simple string input mutation
        hello: mutation(z.string()).handler(async ({ req }) => {
          return {
            message: `Hello ${req.input}`,
          };
        }),

        // Object input mutation
        createUser: mutation(
          z.object({
            name: z.string().min(2),
            email: z.string().email(),
            age: z.number().min(18),
          })
        ).handler(async ({ req }) => {
          return {
            id: "user-123",
            name: req.input.name,
            email: req.input.email,
            age: req.input.age,
          };
        }),

        // Optional input mutation
        optionalGreeting: mutation(z.string().optional()).handler(
          async ({ req }) => {
            return {
              message: req.input ? `Hello ${req.input}` : "Hello World",
            };
          }
        ),

        // No input mutation
        getStats: mutation().handler(async () => {
          return {
            totalUsers: 100,
            activeUsers: 50,
          };
        }),

        // Complex object with nested validation
        updateProfile: mutation(
          z.object({
            name: z.string().optional(),
            email: z.string().email().optional(),
            preferences: z
              .object({
                theme: z.enum(["light", "dark"]),
                notifications: z.boolean(),
              })
              .optional(),
          })
        ).handler(async ({ req }) => {
          return {
            success: true,
            updatedFields: Object.keys(req.input),
          };
        }),

        // Array input mutation
        bulkCreate: mutation(
          z.array(
            z.object({
              name: z.string(),
              email: z.string().email(),
            })
          )
        ).handler(async ({ req }) => {
          return {
            created: req.input.length,
            ids: req.input.map((_, index) => `user-${index}`),
          };
        }),

        // Union type input
        processData: mutation(
          z.union([
            z.object({ type: z.literal("text"), content: z.string() }),
            z.object({ type: z.literal("number"), value: z.number() }),
          ])
        ).handler(async ({ req }) => {
          return {
            processed: true,
            type: req.input.type,
          };
        }),
      })),

    customMutationPosts: publicRoute
      .collectionRoute(customMutationSchema.customMutationPosts)
      .withMutations(({ mutation }) => ({
        // Mutation that returns a different type
        publishPost: mutation(z.string()).handler(async ({ req }) => {
          return {
            published: true,
            postId: req.input,
            publishedAt: new Date(),
          };
        }),

        // Mutation with complex return type
        getPostAnalytics: mutation(z.string()).handler(async ({ req }) => {
          return {
            postId: req.input,
            views: 1000,
            likes: 50,
            comments: 25,
            analytics: {
              dailyViews: [10, 15, 20, 25, 30],
              topKeywords: ["react", "typescript", "web"],
            },
          };
        }),
      })),
  },
});

const {
  store: { query: customMutationQuery, mutate: customMutationMutate },
} = createClient<typeof customMutationRouter>({
  url: "ws://localhost:5001/ws",
  schema: customMutationSchema,
  storage: false,
});

describe("custom mutations websocket client", () => {
  test("should infer simple string input mutation types", () => {
    const helloMutation = customMutationMutate.customMutationUsers.hello;

    expectTypeOf(helloMutation).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(helloMutation).returns.toEqualTypeOf<
      Promise<{
        message: string;
      }>
    >();
  });

  test("should infer object input mutation types", () => {
    const createUserMutation =
      customMutationMutate.customMutationUsers.createUser;

    expectTypeOf(createUserMutation).parameter(0).toEqualTypeOf<{
      name: string;
      email: string;
      age: number;
    }>();

    expectTypeOf(createUserMutation).returns.toEqualTypeOf<
      Promise<{
        id: string;
        name: string;
        email: string;
        age: number;
      }>
    >();
  });

  test("should infer optional input mutation types", () => {
    const optionalGreetingMutation =
      customMutationMutate.customMutationUsers.optionalGreeting;

    expectTypeOf(optionalGreetingMutation)
      .parameter(0)
      .toEqualTypeOf<string | undefined>();

    expectTypeOf(optionalGreetingMutation).returns.toEqualTypeOf<
      Promise<{
        message: string;
      }>
    >();
  });

  test("should infer no input mutation types", () => {
    const getStatsMutation = customMutationMutate.customMutationUsers.getStats;

    // For mutations with no input, the parameter should be optional or undefined
    expectTypeOf(getStatsMutation).parameter(0).toEqualTypeOf<unknown>();

    expectTypeOf(getStatsMutation).returns.toEqualTypeOf<
      Promise<{
        totalUsers: number;
        activeUsers: number;
      }>
    >();
  });

  test("should infer complex object input mutation types", () => {
    const updateProfileMutation =
      customMutationMutate.customMutationUsers.updateProfile;

    expectTypeOf(updateProfileMutation).parameter(0).toEqualTypeOf<{
      name?: string | undefined;
      email?: string | undefined;
      preferences?:
        | {
            theme: "light" | "dark";
            notifications: boolean;
          }
        | undefined;
    }>();

    expectTypeOf(updateProfileMutation).returns.toEqualTypeOf<
      Promise<{
        success: boolean;
        updatedFields: string[];
      }>
    >();
  });

  test("should infer array input mutation types", () => {
    const bulkCreateMutation =
      customMutationMutate.customMutationUsers.bulkCreate;

    expectTypeOf(bulkCreateMutation).parameter(0).toEqualTypeOf<
      {
        name: string;
        email: string;
      }[]
    >();

    expectTypeOf(bulkCreateMutation).returns.toEqualTypeOf<
      Promise<{
        created: number;
        ids: string[];
      }>
    >();
  });

  test("should infer union type input mutation types", () => {
    const processDataMutation =
      customMutationMutate.customMutationUsers.processData;

    expectTypeOf(processDataMutation)
      .parameter(0)
      .toEqualTypeOf<
        { type: "text"; content: string } | { type: "number"; value: number }
      >();

    expectTypeOf(processDataMutation).returns.toEqualTypeOf<
      Promise<{
        processed: boolean;
        type: "text" | "number";
      }>
    >();
  });

  test("should infer mutation types with different return types", () => {
    const publishPostMutation =
      customMutationMutate.customMutationPosts.publishPost;

    expectTypeOf(publishPostMutation).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(publishPostMutation).returns.toEqualTypeOf<
      Promise<{
        published: boolean;
        postId: string;
        publishedAt: Date;
      }>
    >();
  });

  test("should infer mutation types with complex return types", () => {
    const getPostAnalyticsMutation =
      customMutationMutate.customMutationPosts.getPostAnalytics;

    expectTypeOf(getPostAnalyticsMutation).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(getPostAnalyticsMutation).returns.toEqualTypeOf<
      Promise<{
        postId: string;
        views: number;
        likes: number;
        comments: number;
        analytics: {
          dailyViews: number[];
          topKeywords: string[];
        };
      }>
    >();
  });
});

/*
 * Custom mutations fetch client type tests
 */

const customMutationFetchClient = createFetchClient<
  typeof customMutationRouter
>({
  url: "http://localhost:3000",
  schema: customMutationSchema,
  credentials: async () => ({}),
});

describe("custom mutations fetch client", () => {
  test("should infer simple string input mutation types with Promise", () => {
    const helloMutation =
      customMutationFetchClient.mutate.customMutationUsers.hello;

    expectTypeOf(helloMutation).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(helloMutation).returns.toEqualTypeOf<
      Promise<{
        message: string;
      }>
    >();
  });

  test("should infer object input mutation types with Promise", () => {
    const createUserMutation =
      customMutationFetchClient.mutate.customMutationUsers.createUser;

    expectTypeOf(createUserMutation).parameter(0).toEqualTypeOf<{
      name: string;
      email: string;
      age: number;
    }>();

    expectTypeOf(createUserMutation).returns.toEqualTypeOf<
      Promise<{
        id: string;
        name: string;
        email: string;
        age: number;
      }>
    >();
  });

  test("should infer optional input mutation types with Promise", () => {
    const optionalGreetingMutation =
      customMutationFetchClient.mutate.customMutationUsers.optionalGreeting;

    expectTypeOf(optionalGreetingMutation)
      .parameter(0)
      .toEqualTypeOf<string | undefined>();

    expectTypeOf(optionalGreetingMutation).returns.toEqualTypeOf<
      Promise<{
        message: string;
      }>
    >();
  });

  test("should infer no input mutation types with Promise", () => {
    const getStatsMutation =
      customMutationFetchClient.mutate.customMutationUsers.getStats;

    // For mutations with no input, the parameter should be optional or undefined
    expectTypeOf(getStatsMutation).parameter(0).toEqualTypeOf<unknown>();

    expectTypeOf(getStatsMutation).returns.toEqualTypeOf<
      Promise<{
        totalUsers: number;
        activeUsers: number;
      }>
    >();
  });

  test("should infer complex object input mutation types with Promise", () => {
    const updateProfileMutation =
      customMutationFetchClient.mutate.customMutationUsers.updateProfile;

    expectTypeOf(updateProfileMutation).parameter(0).toEqualTypeOf<{
      name?: string | undefined;
      email?: string | undefined;
      preferences?:
        | {
            theme: "light" | "dark";
            notifications: boolean;
          }
        | undefined;
    }>();

    expectTypeOf(updateProfileMutation).returns.toEqualTypeOf<
      Promise<{
        success: boolean;
        updatedFields: string[];
      }>
    >();
  });

  test("should infer array input mutation types with Promise", () => {
    const bulkCreateMutation =
      customMutationFetchClient.mutate.customMutationUsers.bulkCreate;

    expectTypeOf(bulkCreateMutation).parameter(0).toEqualTypeOf<
      {
        name: string;
        email: string;
      }[]
    >();

    expectTypeOf(bulkCreateMutation).returns.toEqualTypeOf<
      Promise<{
        created: number;
        ids: string[];
      }>
    >();
  });

  test("should infer union type input mutation types with Promise", () => {
    const processDataMutation =
      customMutationFetchClient.mutate.customMutationUsers.processData;

    expectTypeOf(processDataMutation)
      .parameter(0)
      .toEqualTypeOf<
        { type: "text"; content: string } | { type: "number"; value: number }
      >();

    expectTypeOf(processDataMutation).returns.toEqualTypeOf<
      Promise<{
        processed: boolean;
        type: "text" | "number";
      }>
    >();
  });

  test("should infer mutation types with different return types and Promise", () => {
    const publishPostMutation =
      customMutationFetchClient.mutate.customMutationPosts.publishPost;

    expectTypeOf(publishPostMutation).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(publishPostMutation).returns.toEqualTypeOf<
      Promise<{
        published: boolean;
        postId: string;
        publishedAt: Date;
      }>
    >();
  });

  test("should infer mutation types with complex return types and Promise", () => {
    const getPostAnalyticsMutation =
      customMutationFetchClient.mutate.customMutationPosts.getPostAnalytics;

    expectTypeOf(getPostAnalyticsMutation).parameter(0).toEqualTypeOf<string>();

    expectTypeOf(getPostAnalyticsMutation).returns.toEqualTypeOf<
      Promise<{
        postId: string;
        views: number;
        likes: number;
        comments: number;
        analytics: {
          dailyViews: number[];
          topKeywords: string[];
        };
      }>
    >();
  });
});
