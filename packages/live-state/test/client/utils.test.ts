import { describe, expect, test, vi } from "vitest";
import {
  createObservable,
  type ObservableHandler,
} from "../../src/client/utils";
import { applyWhere } from "../../src/utils";

describe("createObservable", () => {
  test("should create observable with basic get handler", () => {
    const mockHandler: ObservableHandler<{ name: string }> = {
      get: vi.fn((target, path) => {
        if (path.join(".") === "name") return "intercepted";
        return undefined;
      }),
    };

    const obj = { name: "original" };
    const observable = createObservable(obj, mockHandler);

    expect(observable.name).toBe("intercepted");
    expect(mockHandler.get).toHaveBeenCalledWith(obj, ["name"]);
  });

  test("should fall back to original property when handler returns undefined", () => {
    const mockHandler: ObservableHandler<{ name: string; age: number }> = {
      get: vi.fn(() => undefined),
    };

    const obj = { name: "John", age: 30 };
    const observable = createObservable(obj, mockHandler);

    // Should create nested observables for object properties
    expect(typeof observable.name).toBe("function");
    expect((observable.name as any).__isProxy__).toBe(true);
  });

  test("should handle nested object access", () => {
    const mockHandler: ObservableHandler<{
      user: { profile: { name: string } };
    }> = {
      get: vi.fn((target, path) => {
        if (path.join(".") === "user.profile.name") return "nested value";
        return undefined;
      }),
    };

    const obj = { user: { profile: { name: "original" } } };
    const observable = createObservable(obj, mockHandler);

    // Access nested property
    const result = observable.user.profile.name;

    expect(mockHandler.get).toHaveBeenCalledWith(expect.any(Object), ["user"]);
    expect(mockHandler.get).toHaveBeenCalledWith(expect.any(Object), [
      "user",
      "profile",
    ]);
    expect(mockHandler.get).toHaveBeenCalledWith(expect.any(Object), [
      "user",
      "profile",
      "name",
    ]);
  });

  test("should handle function calls with apply handler", () => {
    const mockHandler: ObservableHandler<{ fn: () => string }> = {
      apply: vi.fn((target, path, args) => {
        if (path.join(".") === "fn") return "applied result";
        return undefined;
      }),
    };

    const obj = { fn: () => "original" };
    const observable = createObservable(obj, mockHandler);

    const result = observable.fn("arg1", "arg2");

    expect(result).toBe("applied result");
    expect(mockHandler.apply).toHaveBeenCalledWith(
      expect.any(Function),
      ["fn"],
      ["arg1", "arg2"]
    );
  });

  test("should handle nested function calls", () => {
    const mockHandler: ObservableHandler<{ api: { getData: () => string } }> = {
      apply: vi.fn((target, path, args) => {
        if (path.join(".") === "api.getData") return "nested function result";
        return undefined;
      }),
    };

    const obj = { api: { getData: () => "original" } };
    const observable = createObservable(obj, mockHandler);

    const result = observable.api.getData();

    expect(result).toBe("nested function result");
    expect(mockHandler.apply).toHaveBeenCalledWith(
      expect.any(Function),
      ["api", "getData"],
      []
    );
  });

  test("should preserve __isProxy__ property", () => {
    const mockHandler: ObservableHandler<{ name: string }> = {};
    const obj = { name: "test" };
    const observable = createObservable(obj, mockHandler);

    expect(observable.__isProxy__).toBe(true);
  });

  test("should not recreate proxy for already proxied objects", () => {
    const mockHandler: ObservableHandler<{ nested: { value: string } }> = {
      get: vi.fn(() => undefined),
    };

    const obj = { nested: { value: "test" } };
    const observable = createObservable(obj, mockHandler);

    // First access creates proxy
    const firstAccess = observable.nested;
    expect(firstAccess.__isProxy__).toBe(true);

    // Second access should return same proxy
    const secondAccess = observable.nested;
    expect(secondAccess).toBe(firstAccess);
  });

  test("should create function proxy for non-object properties", () => {
    const mockHandler: ObservableHandler<{ primitive: string }> = {
      get: vi.fn(() => undefined),
    };

    const obj = { primitive: "test" };
    const observable = createObservable(obj, mockHandler);

    // Accessing primitive should create a function proxy
    const result = observable.primitive;
    expect(typeof result).toBe("function");
    expect(result.__isProxy__).toBe(true);
  });

  test("should handle complex nested scenarios", () => {
    const calls: string[] = [];
    const mockHandler: ObservableHandler<{ a: { b: { c: () => string } } }> = {
      get: vi.fn((target, path) => {
        calls.push(`get:${path.join(".")}`);
        return undefined;
      }),
      apply: vi.fn((target, path, args) => {
        calls.push(`apply:${path.join(".")}`);
        return "final result";
      }),
    };

    const obj = { a: { b: { c: () => "original" } } };
    const observable = createObservable(obj, mockHandler);

    const result = observable.a.b.c();

    expect(result).toBe("final result");
    expect(calls).toEqual(["get:a", "get:a.b", "get:a.b.c", "apply:a.b.c"]);
  });
});

describe("applyWhere", () => {
  test("should return true when all where conditions match", () => {
    const obj = { name: "John", age: 30, active: true };
    const where = { name: "John", age: 30 };

    const result = applyWhere(obj, where);

    expect(result).toBe(true);
  });

  test("should return false when any where condition doesn't match", () => {
    const obj = { name: "John", age: 30, active: true };
    const where = { name: "John", age: 25 };

    const result = applyWhere(obj, where);

    expect(result).toBe(false);
  });

  test("should return true for empty where object", () => {
    const obj = { name: "John", age: 30 };
    const where = {};

    const result = applyWhere(obj, where);

    expect(result).toBe(true);
  });

  test("should handle string comparisons", () => {
    const obj = { name: "Alice", role: "admin" };

    expect(applyWhere(obj, { name: "Alice" })).toBe(true);
    expect(applyWhere(obj, { name: "Bob" })).toBe(false);
    expect(applyWhere(obj, { role: "admin" })).toBe(true);
    expect(applyWhere(obj, { role: "user" })).toBe(false);
  });

  test("should handle number comparisons", () => {
    const obj = { age: 25, score: 100 };

    expect(applyWhere(obj, { age: 25 })).toBe(true);
    expect(applyWhere(obj, { age: 30 })).toBe(false);
    expect(applyWhere(obj, { score: 100 })).toBe(true);
    expect(applyWhere(obj, { score: 90 })).toBe(false);
  });

  test("should handle boolean comparisons", () => {
    const obj = { active: true, verified: false };

    expect(applyWhere(obj, { active: true })).toBe(true);
    expect(applyWhere(obj, { active: false })).toBe(false);
    expect(applyWhere(obj, { verified: false })).toBe(true);
    expect(applyWhere(obj, { verified: true })).toBe(false);
  });

  test("should handle null values", () => {
    const obj = { nonNull: "value", nullValue: null };

    expect(applyWhere(obj, { nullValue: null } as any)).toBe(true);
    expect(applyWhere(obj, { nullValue: "value" })).toBe(false);
    expect(applyWhere(obj, { nonNull: null } as any)).toBe(false);
    expect(applyWhere(obj, { nonNull: "value" })).toBe(true);
    expect(applyWhere(obj, { nullValue: { $not: null } } as any)).toBe(false);
    expect(applyWhere(obj, { nonNull: { $not: null } } as any)).toBe(true);
  });

  test("should handle multiple conditions", () => {
    const obj = { name: "John", age: 30, active: true, role: "admin" };

    expect(applyWhere(obj, { name: "John", age: 30 })).toBe(true);
    expect(applyWhere(obj, { name: "John", age: 25 })).toBe(false);
    expect(applyWhere(obj, { active: true, role: "admin" })).toBe(true);
    expect(applyWhere(obj, { active: true, role: "user" })).toBe(false);
    expect(
      applyWhere(obj, { name: "John", age: 30, active: true, role: "admin" })
    ).toBe(true);
  });

  test("should handle objects with missing properties", () => {
    const obj = { name: "John" };

    expect(applyWhere(obj, { name: "John" })).toBe(true);
    expect(applyWhere(obj, { age: undefined })).toBe(true);
    expect(applyWhere(obj, { age: 30 })).toBe(false);
  });

  test("should use strict equality", () => {
    const obj = { id: "123", count: 0, flag: false };

    // String vs number
    expect(applyWhere(obj, { id: 123 })).toBe(false);
    expect(applyWhere(obj, { id: "123" })).toBe(true);

    // Number vs boolean
    expect(applyWhere(obj, { count: false })).toBe(false);
    expect(applyWhere(obj, { count: 0 })).toBe(true);

    // Boolean vs number
    expect(applyWhere(obj, { flag: 0 })).toBe(false);
    expect(applyWhere(obj, { flag: false })).toBe(true);
  });

  test("should handle deep queries", () => {
    const obj = {
      author: {
        name: "John",
        age: 30,
        active: true,
        role: "admin",
      },
    };

    expect(applyWhere(obj, { author: { name: "John", age: 30 } })).toBe(true);
    expect(applyWhere(obj, { author: { name: "John", age: 25 } })).toBe(false);
    expect(applyWhere(obj, { author: { active: true, role: "admin" } })).toBe(
      true
    );
    expect(applyWhere(obj, { author: { active: true, role: "user" } })).toBe(
      false
    );
    expect(
      applyWhere(obj, {
        author: { name: "John", age: 30, active: true, role: "admin" },
      })
    ).toBe(true);
  });

  test("should handle $eq operator", () => {
    const obj = { message: "Test", author: { name: "John", age: 30 } };

    expect(applyWhere(obj, { message: { $eq: "Test" } })).toBe(true);
    expect(applyWhere(obj, { message: { $eq: "Test2" } })).toBe(false);
    expect(applyWhere(obj, { author: { name: { $eq: "John" } } })).toBe(true);
    expect(applyWhere(obj, { author: { name: { $eq: "Alice" } } })).toBe(false);
    expect(applyWhere(obj, { author: { age: { $eq: 30 } } })).toBe(true);
    expect(applyWhere(obj, { author: { age: { $eq: 25 } } })).toBe(false);
  });

  test("should handle $in operator", () => {
    const obj = { message: "Test", author: { name: "John", age: 30 } };

    expect(applyWhere(obj, { message: { $in: ["Test", "Test2"] } })).toBe(true);
    expect(applyWhere(obj, { message: { $in: ["Test2", "Test3"] } })).toBe(
      false
    );
    expect(
      applyWhere(obj, { author: { name: { $in: ["John", "Alice"] } } })
    ).toBe(true);
    expect(
      applyWhere(obj, { author: { name: { $in: ["Alice", "Bob"] } } })
    ).toBe(false);
    expect(applyWhere(obj, { author: { age: { $in: [30, 25] } } })).toBe(true);
    expect(applyWhere(obj, { author: { age: { $in: [25, 20] } } })).toBe(false);
  });

  test("should handle $not operator", () => {
    const obj = { message: "Test", author: { name: "John", age: 30 } };

    expect(applyWhere(obj, { message: { $not: "Test" } })).toBe(false);
    expect(applyWhere(obj, { message: { $not: "Test2" } })).toBe(true);
    expect(
      applyWhere(obj, { author: { name: { $not: { $eq: "John" } } } })
    ).toBe(false);
    expect(
      applyWhere(obj, { author: { name: { $not: { $eq: "Alice" } } } })
    ).toBe(true);
    expect(applyWhere(obj, { author: { age: { $not: { $eq: 30 } } } })).toBe(
      false
    );
    expect(applyWhere(obj, { author: { age: { $not: { $eq: 25 } } } })).toBe(
      true
    );
  });

  test("should handle $not operator with $in operator", () => {
    const obj = { message: "Test", author: { name: "John", age: 30 } };

    expect(
      applyWhere(obj, { message: { $not: { $in: ["Test", "Test2"] } } })
    ).toBe(false);
    expect(
      applyWhere(obj, { message: { $not: { $in: ["Test2", "Test3"] } } })
    ).toBe(true);
    expect(
      applyWhere(obj, {
        author: { name: { $not: { $in: ["John", "Alice"] } } },
      })
    ).toBe(false);
    expect(
      applyWhere(obj, { author: { name: { $not: { $in: ["Alice", "Bob"] } } } })
    ).toBe(true);
    expect(
      applyWhere(obj, { author: { age: { $not: { $in: [30, 25] } } } })
    ).toBe(false);
    expect(
      applyWhere(obj, { author: { age: { $not: { $in: [25, 20] } } } })
    ).toBe(true);
  });

  test("should handle $and operator", () => {
    const obj = { message: "Test", author: { name: "John", age: 30 } };

    expect(
      applyWhere(obj, {
        $and: [{ message: "Test" }, { author: { name: "John" } }],
      })
    ).toBe(true);
    expect(
      applyWhere(obj, {
        $and: [{ message: "Test" }, { author: { name: "Alice" } }],
      })
    ).toBe(false);
    expect(
      applyWhere(obj, {
        $and: [
          { author: { name: { $in: ["John", "Alice"] } } },
          { author: { age: { $not: 25 } } },
        ],
      })
    ).toBe(true);
    expect(
      applyWhere(obj, {
        $and: [
          { author: { name: { $in: ["John", "Alice"] } } },
          { author: { age: 25 } },
        ],
      })
    ).toBe(false);
  });

  test("should handle $or operator", () => {
    const obj = { message: "Test", author: { name: "John", age: 30 } };

    expect(
      applyWhere(obj, {
        $or: [{ message: "Test" }, { author: { name: "Not John" } }],
      })
    ).toBe(true);
    expect(
      applyWhere(obj, {
        $or: [
          { message: "Not Test" },
          { author: { name: { $not: "Not John" } } },
        ],
      })
    ).toBe(true);
    expect(
      applyWhere(obj, {
        $or: [{ message: "Not Test" }, { author: { name: "Not John" } }],
      })
    ).toBe(false);
    expect(
      applyWhere(obj, {
        $or: [{ message: { $not: "Test" } }, { author: { name: "Not John" } }],
      })
    ).toBe(false);
  });

  test("should handle $gt operator", () => {
    const obj = { score: 85, price: 29.99, count: 0 };

    // Basic greater than comparisons
    expect(applyWhere(obj, { score: { $gt: 80 } })).toBe(true);
    expect(applyWhere(obj, { score: { $gt: 85 } })).toBe(false);
    expect(applyWhere(obj, { score: { $gt: 90 } })).toBe(false);

    // Decimal comparisons
    expect(applyWhere(obj, { price: { $gt: 29.98 } })).toBe(true);
    expect(applyWhere(obj, { price: { $gt: 29.99 } })).toBe(false);
    expect(applyWhere(obj, { price: { $gt: 30.0 } })).toBe(false);

    // Zero comparisons
    expect(applyWhere(obj, { count: { $gt: -1 } })).toBe(true);
    expect(applyWhere(obj, { count: { $gt: 0 } })).toBe(false);
    expect(applyWhere(obj, { count: { $gt: 1 } })).toBe(false);
  });

  test("should handle $gte operator", () => {
    const obj = { score: 85, price: 29.99, count: 0 };

    // Basic greater than or equal comparisons
    expect(applyWhere(obj, { score: { $gte: 80 } })).toBe(true);
    expect(applyWhere(obj, { score: { $gte: 85 } })).toBe(true);
    expect(applyWhere(obj, { score: { $gte: 90 } })).toBe(false);

    // Decimal comparisons
    expect(applyWhere(obj, { price: { $gte: 29.98 } })).toBe(true);
    expect(applyWhere(obj, { price: { $gte: 29.99 } })).toBe(true);
    expect(applyWhere(obj, { price: { $gte: 30.0 } })).toBe(false);

    // Zero comparisons
    expect(applyWhere(obj, { count: { $gte: -1 } })).toBe(true);
    expect(applyWhere(obj, { count: { $gte: 0 } })).toBe(true);
    expect(applyWhere(obj, { count: { $gte: 1 } })).toBe(false);
  });

  test("should handle $lt operator", () => {
    const obj = { score: 85, price: 29.99, count: 0 };

    // Basic less than comparisons
    expect(applyWhere(obj, { score: { $lt: 90 } })).toBe(true);
    expect(applyWhere(obj, { score: { $lt: 85 } })).toBe(false);
    expect(applyWhere(obj, { score: { $lt: 80 } })).toBe(false);

    // Decimal comparisons
    expect(applyWhere(obj, { price: { $lt: 30.0 } })).toBe(true);
    expect(applyWhere(obj, { price: { $lt: 29.99 } })).toBe(false);
    expect(applyWhere(obj, { price: { $lt: 29.98 } })).toBe(false);

    // Zero comparisons
    expect(applyWhere(obj, { count: { $lt: 1 } })).toBe(true);
    expect(applyWhere(obj, { count: { $lt: 0 } })).toBe(false);
    expect(applyWhere(obj, { count: { $lt: -1 } })).toBe(false);
  });

  test("should handle $lte operator", () => {
    const obj = { score: 85, price: 29.99, count: 0 };

    // Basic less than or equal comparisons
    expect(applyWhere(obj, { score: { $lte: 90 } })).toBe(true);
    expect(applyWhere(obj, { score: { $lte: 85 } })).toBe(true);
    expect(applyWhere(obj, { score: { $lte: 80 } })).toBe(false);

    // Decimal comparisons
    expect(applyWhere(obj, { price: { $lte: 30.0 } })).toBe(true);
    expect(applyWhere(obj, { price: { $lte: 29.99 } })).toBe(true);
    expect(applyWhere(obj, { price: { $lte: 29.98 } })).toBe(false);

    // Zero comparisons
    expect(applyWhere(obj, { count: { $lte: 1 } })).toBe(true);
    expect(applyWhere(obj, { count: { $lte: 0 } })).toBe(true);
    expect(applyWhere(obj, { count: { $lte: -1 } })).toBe(false);
  });

  test("should handle comparison operators with nested objects", () => {
    const obj = {
      user: { age: 25, score: 87.5 },
      product: { price: 19.99, rating: 4.2 },
    };

    // Nested $gt
    expect(applyWhere(obj, { user: { age: { $gt: 20 } } })).toBe(true);
    expect(applyWhere(obj, { user: { age: { $gt: 25 } } })).toBe(false);
    expect(applyWhere(obj, { product: { rating: { $gt: 4.0 } } })).toBe(true);

    // Nested $gte
    expect(applyWhere(obj, { user: { age: { $gte: 25 } } })).toBe(true);
    expect(applyWhere(obj, { user: { score: { $gte: 87.5 } } })).toBe(true);

    // Nested $lt
    expect(applyWhere(obj, { user: { age: { $lt: 30 } } })).toBe(true);
    expect(applyWhere(obj, { product: { price: { $lt: 20.0 } } })).toBe(true);

    // Nested $lte
    expect(applyWhere(obj, { user: { age: { $lte: 25 } } })).toBe(true);
    expect(applyWhere(obj, { product: { rating: { $lte: 4.2 } } })).toBe(true);
  });

  test("should handle comparison operators with $not", () => {
    const obj = { age: 30, score: 85 };

    // $not with $gt
    expect(applyWhere(obj, { age: { $not: { $gt: 25 } } })).toBe(false);
    expect(applyWhere(obj, { age: { $not: { $gt: 35 } } })).toBe(true);

    // $not with $gte
    expect(applyWhere(obj, { age: { $not: { $gte: 30 } } })).toBe(false);
    expect(applyWhere(obj, { age: { $not: { $gte: 35 } } })).toBe(true);

    // $not with $lt
    expect(applyWhere(obj, { score: { $not: { $lt: 90 } } })).toBe(false);
    expect(applyWhere(obj, { score: { $not: { $lt: 80 } } })).toBe(true);

    // $not with $lte
    expect(applyWhere(obj, { score: { $not: { $lte: 85 } } })).toBe(false);
    expect(applyWhere(obj, { score: { $not: { $lte: 80 } } })).toBe(true);
  });

  test("should handle multiple comparison operators", () => {
    const obj = { age: 25, score: 85, price: 29.99 };

    // Multiple conditions with different operators
    expect(
      applyWhere(obj, {
        age: { $gte: 18 },
        score: { $gt: 80 },
        price: { $lt: 30 },
      })
    ).toBe(true);

    expect(
      applyWhere(obj, {
        age: { $gte: 30 },
        score: { $gt: 80 },
      })
    ).toBe(false);

    // Range queries (between values) using $and
    expect(
      applyWhere(obj, {
        $and: [{ age: { $gte: 20 } }, { age: { $lte: 30 } }],
      })
    ).toBe(true);

    expect(
      applyWhere(obj, {
        $and: [{ score: { $gt: 80 } }, { score: { $lt: 90 } }],
      })
    ).toBe(true);
  });

  test("should handle comparison operators with $and and $or", () => {
    const obj = { age: 25, score: 85, active: true };

    // $and with comparison operators
    expect(
      applyWhere(obj, {
        $and: [{ age: { $gte: 18 } }, { score: { $gt: 80 } }, { active: true }],
      })
    ).toBe(true);

    expect(
      applyWhere(obj, {
        $and: [{ age: { $gte: 30 } }, { score: { $gt: 80 } }],
      })
    ).toBe(false);

    // $or with comparison operators
    expect(
      applyWhere(obj, {
        $or: [{ age: { $lt: 18 } }, { score: { $gte: 85 } }],
      })
    ).toBe(true);

    expect(
      applyWhere(obj, {
        $or: [{ age: { $lt: 18 } }, { score: { $lt: 70 } }],
      })
    ).toBe(false);
  });
});
