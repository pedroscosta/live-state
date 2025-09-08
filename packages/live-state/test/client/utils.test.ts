import { describe, expect, test, vi } from "vitest";
import {
  applyWhere,
  createObservable,
  type ObservableHandler,
} from "../../src/client/utils";

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

  test("should handle null and undefined values", () => {
    const obj = { value: null, other: undefined, name: "test" };

    expect(applyWhere(obj, { value: null })).toBe(true);
    expect(applyWhere(obj, { value: undefined })).toBe(false);
    expect(applyWhere(obj, { other: undefined })).toBe(true);
    expect(applyWhere(obj, { other: null })).toBe(false);
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
});
