import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Schema, WhereClause } from "../src/schema";
import { extractIncludeFromWhere, applyWhere } from "../src/utils";

describe("extractIncludeFromWhere", () => {
  let mockSchema: Schema<any>;

  beforeEach(() => {
    const postsEntity = {
      name: "posts",
      fields: {
        id: {
          _value: "string",
          _meta: {},
          encodeMutation: vi.fn(),
          mergeMutation: vi.fn(),
          getStorageFieldType: vi.fn(),
        },
        title: {
          _value: "string",
          _meta: {},
          encodeMutation: vi.fn(),
          mergeMutation: vi.fn(),
          getStorageFieldType: vi.fn(),
        },
        published: {
          _value: "boolean",
          _meta: {},
          encodeMutation: vi.fn(),
          mergeMutation: vi.fn(),
          getStorageFieldType: vi.fn(),
        },
      },
      relations: {
        comments: {
          entity: {
            name: "comments",
            fields: {
              id: {
                _value: "string",
                _meta: {},
                encodeMutation: vi.fn(),
                mergeMutation: vi.fn(),
                getStorageFieldType: vi.fn(),
              },
              text: {
                _value: "string",
                _meta: {},
                encodeMutation: vi.fn(),
                mergeMutation: vi.fn(),
                getStorageFieldType: vi.fn(),
              },
              approved: {
                _value: "boolean",
                _meta: {},
                encodeMutation: vi.fn(),
                mergeMutation: vi.fn(),
                getStorageFieldType: vi.fn(),
              },
            },
            relations: {},
          },
          type: "many",
          required: false,
          foreignColumn: undefined,
          relationalColumn: undefined,
        },
      },
    };

    mockSchema = {
      users: {
        name: "users",
        fields: {
          id: {
            _value: "string",
            _meta: {},
            encodeMutation: vi.fn(),
            mergeMutation: vi.fn(),
            getStorageFieldType: vi.fn(),
          },
          name: {
            _value: "string",
            _meta: {},
            encodeMutation: vi.fn(),
            mergeMutation: vi.fn(),
            getStorageFieldType: vi.fn(),
          },
        },
        relations: {
          posts: {
            entity: postsEntity,
            type: "many",
            required: false,
            foreignColumn: undefined,
            relationalColumn: undefined,
          },
          profile: {
            entity: {
              name: "profiles",
              fields: {},
              relations: {},
            },
            type: "one",
            required: false,
            foreignColumn: undefined,
            relationalColumn: undefined,
          },
        },
      },
      posts: postsEntity,
      profiles: {
        name: "profiles",
        fields: {
          bio: {
            _value: "string",
            _meta: {},
            encodeMutation: vi.fn(),
            mergeMutation: vi.fn(),
            getStorageFieldType: vi.fn(),
          },
        },
        relations: {},
      },
      comments: {
        name: "comments",
        fields: {
          id: {
            _value: "string",
            _meta: {},
            encodeMutation: vi.fn(),
            mergeMutation: vi.fn(),
            getStorageFieldType: vi.fn(),
          },
          text: {
            _value: "string",
            _meta: {},
            encodeMutation: vi.fn(),
            mergeMutation: vi.fn(),
            getStorageFieldType: vi.fn(),
          },
          approved: {
            _value: "boolean",
            _meta: {},
            encodeMutation: vi.fn(),
            mergeMutation: vi.fn(),
            getStorageFieldType: vi.fn(),
          },
        },
        relations: {},
      },
    } as any;
  });

  test("should extract simple relation from where clause", () => {
    const where: WhereClause<any> = {
      posts: {
        title: "My Post",
      },
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
    });
  });

  test("should extract multiple relations from where clause", () => {
    const where: WhereClause<any> = {
      posts: {
        title: "My Post",
      },
      profile: {
        bio: "Test",
      },
    };

    // Mock profile relation
    (mockSchema.users as any).relations.profile = {
      entity: { name: "profiles" },
      type: "one",
      required: false,
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
      profile: true,
    });
  });

  test("should extract nested relations", () => {
    const where: WhereClause<any> = {
      posts: {
        comments: {
          text: "Great!",
        },
      },
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: {
        comments: true,
      },
    });
  });

  test("should extract deeply nested relations", () => {
    // Mock deep nesting
    const reactionsEntity = {
      name: "reactions",
      fields: {},
      relations: {},
    };

    const commentsEntity = {
      name: "comments",
      fields: {},
      relations: {
        reactions: {
          entity: reactionsEntity,
          type: "many",
          required: false,
          foreignColumn: undefined,
          relationalColumn: undefined,
        },
      },
    };

    const postsEntity = {
      name: "posts",
      fields: {},
      relations: {
        comments: {
          entity: commentsEntity,
          type: "many",
          required: false,
          foreignColumn: undefined,
          relationalColumn: undefined,
        },
      },
    };

    const mockDeepSchema = {
      users: {
        name: "users",
        fields: {},
        relations: {
          posts: {
            entity: postsEntity,
            type: "many",
            required: false,
            foreignColumn: undefined,
            relationalColumn: undefined,
          },
        },
      },
      posts: postsEntity,
      comments: commentsEntity,
      reactions: reactionsEntity,
    } as any;

    const where: WhereClause<any> = {
      posts: {
        comments: {
          reactions: {
            type: "like",
          },
        },
      },
    };

    const result = extractIncludeFromWhere(where, "users", mockDeepSchema);

    expect(result).toEqual({
      posts: {
        comments: {
          reactions: true,
        },
      },
    });
  });

  test("should handle $and operator", () => {
    const where: WhereClause<any> = {
      $and: [
        {
          name: "John",
        },
        {
          posts: {
            title: "My Post",
          },
        },
      ],
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
    });
  });

  test("should handle $or operator", () => {
    const where: WhereClause<any> = {
      $or: [
        {
          name: "John",
        },
        {
          posts: {
            title: "My Post",
          },
        },
      ],
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
    });
  });

  test("should handle nested $and and $or operators", () => {
    const where: WhereClause<any> = {
      $and: [
        {
          name: "John",
          $or: [
            {
              posts: {
                title: "Post 1",
              },
            },
            {
              posts: {
                title: "Post 2",
              },
            },
          ],
        },
      ],
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
    });
  });

  test("should not extract fields that are not relations", () => {
    const where: WhereClause<any> = {
      name: "John",
      id: "user1",
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({});
  });

  test("should handle empty where clause", () => {
    const where: WhereClause<any> = {};

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({});
  });

  test("should handle complex nested structures", () => {
    const where: WhereClause<any> = {
      $and: [
        {
          name: "John",
          posts: {
            $and: [
              {
                title: "Post 1",
                comments: {
                  text: "Great!",
                },
              },
            ],
          },
        },
      ],
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: {
        comments: true,
      },
    });
  });

  test("should handle arrays in relation values", () => {
    const where: WhereClause<any> = {
      posts: ["post1", "post2"],
    };

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
    });
  });

  test("should handle null values in relation", () => {
    const where: WhereClause<any> = {
      posts: null,
    } as any;

    const result = extractIncludeFromWhere(where, "users", mockSchema);

    expect(result).toEqual({
      posts: true,
    });
  });
});

describe("applyWhere with arrays", () => {
  test("should match where clause against array elements", () => {
    const obj = {
      items: [
        { name: "item1", value: 10 },
        { name: "item2", value: 20 },
        { name: "item3", value: 30 },
      ],
    };

    const where = {
      items: {
        value: 20,
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should return false if no array element matches", () => {
    const obj = {
      items: [
        { name: "item1", value: 10 },
        { name: "item2", value: 20 },
      ],
    };

    const where = {
      items: {
        value: 50,
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false);
  });

  test("should handle nested where clauses in array", () => {
    const obj = {
      items: [
        { name: "item1", nested: { value: 10 } },
        { name: "item2", nested: { value: 20 } },
      ],
    };

    const where = {
      items: {
        nested: {
          value: 20,
        },
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should handle multiple conditions in array", () => {
    const obj = {
      items: [
        { name: "item1", active: true, value: 10 },
        { name: "item2", active: false, value: 20 },
        { name: "item3", active: true, value: 30 },
      ],
    };

    const where = {
      items: {
        active: true,
        value: 30,
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should handle $not operator with arrays", () => {
    const obj = {
      items: [
        { name: "item1", value: 10 },
        { name: "item2", value: 20 },
      ],
    };

    const where = {
      items: {
        $not: {
          value: 50,
        },
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true); // All items have value !== 50
  });

  test("should handle $in operator with arrays", () => {
    const obj = {
      items: [
        { name: "item1", value: 10 },
        { name: "item2", value: 20 },
      ],
    };

    const where = {
      items: {
        value: { $in: [20, 30, 40] },
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true); // item2 has value 20 which is in the array
  });

  test("should handle numeric comparisons with arrays", () => {
    const obj = {
      items: [
        { name: "item1", value: 10 },
        { name: "item2", value: 20 },
      ],
    };

    const where = {
      items: {
        value: { $gt: 15 },
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true); // item2 has value 20 > 15
  });

  test("should handle empty array", () => {
    const obj = {
      items: [],
    };

    const where = {
      items: {
        value: 10,
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false);
  });

  test("should handle array with empty objects", () => {
    const obj = {
      items: [{}],
    };

    const where = {
      items: {
        value: 10,
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false);
  });

  test("should handle complex nested arrays", () => {
    const obj = {
      sections: [
        {
          items: [{ value: 10 }, { value: 20 }],
        },
        {
          items: [{ value: 30 }, { value: 40 }],
        },
      ],
    };

    const where = {
      sections: {
        items: {
          value: 40,
        },
      },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });
});
