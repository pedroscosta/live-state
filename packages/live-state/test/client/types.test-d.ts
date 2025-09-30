import {
  createRelations,
  createSchema,
  id,
  object,
  reference,
  string,
} from "../../src/schema";
import { createClient } from "../../src/client";
import { router as createRouter, routeFactory } from "../../src/server/router";
import { describe, expectTypeOf, test } from "vitest";

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
