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

describe("applyWhere with $eq operator", () => {
  test("should match when value equals $eq value", () => {
    const obj = { id: "user1", name: "John" };

    const where = {
      id: { $eq: "user1" },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should not match when value does not equal $eq value", () => {
    const obj = { id: "user1", name: "John" };

    const where = {
      id: { $eq: "user2" },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false);
  });

  test("should handle $not with $eq operator", () => {
    const obj = { id: "user1", name: "John" };

    const where = {
      id: { $not: { $eq: "user2" } },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true); // user1 !== user2
  });

  test("should handle $not with $eq when value matches", () => {
    const obj = { id: "user1", name: "John" };

    const where = {
      id: { $not: { $eq: "user1" } },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false); // user1 === user1, so $not returns false
  });
});

describe("applyWhere with comparison operators", () => {
  test("should handle $gt operator", () => {
    const obj = { id: "item1", price: 100 };

    expect(applyWhere(obj, { price: { $gt: 50 } } as any)).toBe(true);
    expect(applyWhere(obj, { price: { $gt: 100 } } as any)).toBe(false);
    expect(applyWhere(obj, { price: { $gt: 150 } } as any)).toBe(false);
  });

  test("should handle $gte operator", () => {
    const obj = { id: "item1", price: 100 };

    expect(applyWhere(obj, { price: { $gte: 50 } } as any)).toBe(true);
    expect(applyWhere(obj, { price: { $gte: 100 } } as any)).toBe(true);
    expect(applyWhere(obj, { price: { $gte: 150 } } as any)).toBe(false);
  });

  test("should handle $lt operator", () => {
    const obj = { id: "item1", price: 100 };

    expect(applyWhere(obj, { price: { $lt: 150 } } as any)).toBe(true);
    expect(applyWhere(obj, { price: { $lt: 100 } } as any)).toBe(false);
    expect(applyWhere(obj, { price: { $lt: 50 } } as any)).toBe(false);
  });

  test("should handle $lte operator", () => {
    const obj = { id: "item1", price: 100 };

    expect(applyWhere(obj, { price: { $lte: 150 } } as any)).toBe(true);
    expect(applyWhere(obj, { price: { $lte: 100 } } as any)).toBe(true);
    expect(applyWhere(obj, { price: { $lte: 50 } } as any)).toBe(false);
  });

  test("should handle $not with $gt operator", () => {
    const obj = { id: "item1", price: 100 };

    // $not $gt 50 means price <= 50
    expect(applyWhere(obj, { price: { $not: { $gt: 50 } } } as any)).toBe(false); // 100 > 50, so $not is false
    expect(applyWhere(obj, { price: { $not: { $gt: 100 } } } as any)).toBe(true); // 100 is not > 100
    expect(applyWhere(obj, { price: { $not: { $gt: 150 } } } as any)).toBe(true); // 100 is not > 150
  });

  test("should handle $not with $lt operator", () => {
    const obj = { id: "item1", price: 100 };

    // $not $lt 150 means price >= 150
    expect(applyWhere(obj, { price: { $not: { $lt: 150 } } } as any)).toBe(false); // 100 < 150, so $not is false
    expect(applyWhere(obj, { price: { $not: { $lt: 100 } } } as any)).toBe(true); // 100 is not < 100
    expect(applyWhere(obj, { price: { $not: { $lt: 50 } } } as any)).toBe(true); // 100 is not < 50
  });

  test("should return false for non-numeric values with comparison operators", () => {
    const obj = { id: "item1", name: "Test" };

    expect(applyWhere(obj, { name: { $gt: 50 } } as any)).toBe(false);
    expect(applyWhere(obj, { name: { $gte: 50 } } as any)).toBe(false);
    expect(applyWhere(obj, { name: { $lt: 50 } } as any)).toBe(false);
    expect(applyWhere(obj, { name: { $lte: 50 } } as any)).toBe(false);
  });

  test("should handle combined comparison operators", () => {
    const obj = { id: "item1", price: 100 };

    // price > 50 AND price < 150
    const where = {
      $and: [{ price: { $gt: 50 } }, { price: { $lt: 150 } }],
    };

    expect(applyWhere(obj, where as any)).toBe(true);
  });

  test("should handle range with $gte and $lte", () => {
    const objInRange = { id: "item1", price: 100 };
    const objOutOfRange = { id: "item2", price: 200 };

    const where = {
      $and: [{ price: { $gte: 50 } }, { price: { $lte: 150 } }],
    };

    expect(applyWhere(objInRange, where as any)).toBe(true);
    expect(applyWhere(objOutOfRange, where as any)).toBe(false);
  });
});

describe("applyWhere with $not operator", () => {
  test("should negate simple equality", () => {
    const obj = { id: "user1", status: "active" };

    const where = {
      status: { $not: "inactive" },
    };

    expect(applyWhere(obj, where as any)).toBe(true); // "active" !== "inactive"
  });

  test("should negate when value matches", () => {
    const obj = { id: "user1", status: "active" };

    const where = {
      status: { $not: "active" },
    };

    expect(applyWhere(obj, where as any)).toBe(false); // "active" === "active"
  });

  test("should handle nested $not with $in", () => {
    const obj = { id: "user1", role: "viewer" };

    const where = {
      role: { $not: { $in: ["admin", "moderator"] } },
    };

    expect(applyWhere(obj, where as any)).toBe(true); // "viewer" not in ["admin", "moderator"]
  });
});

describe("applyWhere with $in operator", () => {
  test("should match when value is in $in array", () => {
    const obj = { id: "user1", name: "John", status: "active" };

    const where = {
      status: { $in: ["active", "pending"] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should not match when value is not in $in array", () => {
    const obj = { id: "user1", name: "John", status: "inactive" };

    const where = {
      status: { $in: ["active", "pending"] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false);
  });

  test("should handle $in with id field", () => {
    const obj = { id: "user1", name: "John" };

    const where = {
      id: { $in: ["user1", "user2", "user3"] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should handle $in with numeric values", () => {
    const obj = { id: "item1", quantity: 5 };

    const where = {
      quantity: { $in: [1, 5, 10] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should handle $not with $in operator", () => {
    const obj = { id: "user1", status: "deleted" };

    const where = {
      status: { $not: { $in: ["active", "pending"] } },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true); // "deleted" is not in ["active", "pending"]
  });

  test("should handle $not with $in operator when value is in array", () => {
    const obj = { id: "user1", status: "active" };

    const where = {
      status: { $not: { $in: ["active", "pending"] } },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false); // "active" is in ["active", "pending"]
  });

  test("should handle $in with empty array", () => {
    const obj = { id: "user1", status: "active" };

    const where = {
      status: { $in: [] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false); // Nothing can match an empty array
  });

  test("should handle $in with undefined field", () => {
    const obj = { id: "user1", name: "John" };

    const where = {
      status: { $in: ["active", "pending"] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false); // Field is undefined
  });

  test("should handle multiple $in conditions", () => {
    const obj = { id: "user1", status: "active", role: "admin" };

    const where = {
      status: { $in: ["active", "pending"] },
      role: { $in: ["admin", "moderator"] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should handle multiple $in conditions with one not matching", () => {
    const obj = { id: "user1", status: "active", role: "user" };

    const where = {
      status: { $in: ["active", "pending"] },
      role: { $in: ["admin", "moderator"] },
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(false); // "user" is not in ["admin", "moderator"]
  });

  test("should handle $in with $and operator", () => {
    const obj = { id: "user1", status: "active", name: "John" };

    const where = {
      $and: [{ status: { $in: ["active", "pending"] } }, { name: "John" }],
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true);
  });

  test("should handle $in with $or operator", () => {
    const obj = { id: "user1", status: "inactive", name: "John" };

    const where = {
      $or: [{ status: { $in: ["active", "pending"] } }, { name: "John" }],
    };

    const result = applyWhere(obj, where as any);
    expect(result).toBe(true); // name: "John" matches
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
