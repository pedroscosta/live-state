import { describe, expect, test } from "vitest";
import {
  createRelations,
  createSchema,
  id,
  inferValue,
  LiveObject,
  MutationType,
  number,
  object,
  reference,
  string,
} from "../../src/schema";

describe("LiveObject", () => {
  test("should create a LiveObject instance", () => {
    const user = object("users", {
      id: id(),
      name: string(),
      age: number(),
    });

    expect(user).toBeInstanceOf(LiveObject);
    expect(user.name).toBe("users");
    expect(user.fields.id).toBeDefined();
    expect(user.fields.name).toBeDefined();
    expect(user.fields.age).toBeDefined();
  });

  test("should encode mutation correctly", () => {
    const user = object("users", {
      id: id(),
      name: string(),
      age: number(),
    });

    const timestamp = "2023-01-01T00:00:00.000Z";
    const input = {
      id: "user1",
      name: "John Doe",
      age: 30,
    };

    const result = user.encodeMutation("set", input, timestamp);

    expect(result).toEqual({
      id: {
        value: "user1",
        _meta: { timestamp },
      },
      name: {
        value: "John Doe",
        _meta: { timestamp },
      },
      age: {
        value: 30,
        _meta: { timestamp },
      },
    });
  });

  test("should merge mutation correctly", () => {
    const user = object("users", {
      id: id(),
      name: string(),
      age: number(),
    });

    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutations = {
      id: {
        value: "user1",
        _meta: { timestamp },
      },
      name: {
        value: "John Doe",
        _meta: { timestamp },
      },
      age: {
        value: 30,
        _meta: { timestamp },
      },
    };

    const [newValue, acceptedMutations] = user.mergeMutation(
      "set",
      encodedMutations
    );

    expect(newValue.value).toEqual({
      id: {
        value: "user1",
        _meta: { timestamp },
      },
      name: {
        value: "John Doe",
        _meta: { timestamp },
      },
      age: {
        value: 30,
        _meta: { timestamp },
      },
    });

    expect(acceptedMutations).toEqual({
      id: {
        value: "user1",
        _meta: { timestamp },
      },
      name: {
        value: "John Doe",
        _meta: { timestamp },
      },
      age: {
        value: 30,
        _meta: { timestamp },
      },
    });
  });

  test("should merge with existing materialized shape", () => {
    const user = object("users", {
      id: id(),
      name: string(),
      age: number(),
    });

    const oldTimestamp = "2023-01-01T00:00:00.000Z";
    const newTimestamp = "2023-01-02T00:00:00.000Z";

    const materializedShape = {
      value: {
        id: {
          value: "user1",
          _meta: { timestamp: oldTimestamp },
        },
        name: {
          value: "John Doe",
          _meta: { timestamp: oldTimestamp },
        },
        age: {
          value: 30,
          _meta: { timestamp: oldTimestamp },
        },
      },
      _meta: { timestamp: oldTimestamp },
    };

    const encodedMutations = {
      name: {
        value: "Jane Doe",
        _meta: { timestamp: newTimestamp },
      },
    };

    const [newValue, acceptedMutations] = user.mergeMutation(
      "set",
      encodedMutations,
      materializedShape
    );

    expect(newValue.value).toEqual({
      id: {
        value: "user1",
        _meta: { timestamp: oldTimestamp },
      },
      name: {
        value: "Jane Doe",
        _meta: { timestamp: newTimestamp },
      },
      age: {
        value: 30,
        _meta: { timestamp: oldTimestamp },
      },
    });

    expect(acceptedMutations).toEqual({
      name: {
        value: "Jane Doe",
        _meta: { timestamp: newTimestamp },
      },
    });
  });

  test("should set relations", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const userRelations = createRelations(user, ({ many }) => ({
      posts: many(post, "userId"),
    }));

    const userWithRelations = user.setRelations(userRelations.relations);

    expect(userWithRelations.relations).toBe(userRelations.relations);
    expect(userWithRelations.name).toBe(user.name);
    expect(userWithRelations.fields).toBe(user.fields);
  });

  test("should throw error for getStorageFieldType", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    expect(() => user.getStorageFieldType()).toThrow("Method not implemented.");
  });
});

describe("Relation", () => {
  test("should create one-to-many relation", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const userRelations = createRelations(user, ({ many }) => ({
      posts: many(post, "userId"),
    }));

    expect(userRelations.$type).toBe("relations");
    expect(userRelations.objectName).toBe("users");
    expect(userRelations.relations.posts).toBeDefined();
    expect(userRelations.relations.posts.type).toBe("many");
    expect(userRelations.relations.posts.entity).toBe(post);
    expect(userRelations.relations.posts.foreignColumn).toBe("userId");
  });

  test("should create many-to-one relation", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const postRelations = createRelations(post, ({ one }) => ({
      author: one(user, "userId"),
    }));

    expect(postRelations.$type).toBe("relations");
    expect(postRelations.objectName).toBe("posts");
    expect(postRelations.relations.author).toBeDefined();
    expect(postRelations.relations.author.type).toBe("one");
    expect(postRelations.relations.author.entity).toBe(user);
    expect(postRelations.relations.author.relationalColumn).toBe("userId");
  });

  test("should encode one relation mutation", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const postRelations = createRelations(post, ({ one }) => ({
      author: one(user, "userId"),
    }));

    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = postRelations.relations.author.encodeMutation(
      "set",
      "user1",
      timestamp
    );

    expect(result).toEqual({
      value: "user1",
      _meta: {
        timestamp,
      },
    });
  });

  test("should throw error for many relation encodeMutation", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const userRelations = createRelations(user, ({ many }) => ({
      posts: many(post, "userId"),
    }));

    expect(() => {
      userRelations.relations.posts.encodeMutation(
        "set",
        "post1",
        "2023-01-01T00:00:00.000Z"
      );
    }).toThrow("Many not implemented.");
  });

  test("should throw error for non-set mutation type", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const postRelations = createRelations(post, ({ one }) => ({
      author: one(user, "userId", true),
    }));

    expect(() => {
      postRelations.relations.author.encodeMutation(
        "delete" as MutationType,
        "user1",
        "2023-01-01T00:00:00.000Z"
      );
    }).toThrow("Mutation type not implemented.");
  });

  test("should serialize relation to JSON", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const postRelations = createRelations(post, ({ one }) => ({
      author: one(user, "userId", true),
    }));

    const json = postRelations.relations.author.toJSON();

    expect(json).toEqual({
      entityName: "users",
      type: "one",
      required: true,
      relationalColumn: "userId",
      foreignColumn: undefined,
    });
  });
});

describe("createSchema", () => {
  test("should create schema with objects and relations", () => {
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      userId: reference("users.id"),
    });

    const userRelations = createRelations(user, ({ many }) => ({
      posts: many(post, "userId"),
    }));

    const postRelations = createRelations(post, ({ one }) => ({
      author: one(user, "userId"),
    }));

    const schema = createSchema({
      user,
      post,
      userRelations,
      postRelations,
    });

    expect(schema.users).toBeDefined();
    expect(schema.posts).toBeDefined();
    expect(schema.users.relations.posts).toBeDefined();
    expect(schema.posts.relations.author).toBeDefined();
  });
});

describe("inferValue", () => {
  test("should infer primitive value", () => {
    const value = {
      value: "test",
      _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
    };

    const result = inferValue(value);
    expect(result).toBe("test");
  });

  test("should infer Date value", () => {
    const date = new Date();
    const value = {
      value: date,
      _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
    };

    const result = inferValue(value);
    expect(result).toBe(date);
  });

  test("should infer object value", () => {
    const value = {
      value: {
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
        age: {
          value: 30,
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
      _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
    };

    const result = inferValue(value);
    expect(result).toEqual({
      name: "John",
      age: 30,
    });
  });

  test("should infer array value", () => {
    const value = {
      value: [
        {
          value: "item1",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
        {
          value: "item2",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      ],
      _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
    };

    const result = inferValue(value);
    expect(result).toEqual(["item1", "item2"]);
  });

  test("should return undefined for undefined input", () => {
    const result = inferValue(undefined);
    expect(result).toBeUndefined();
  });
});
