import { describe, expect, test } from "vitest";
import {
  boolean,
  id,
  LiveBoolean,
  LiveNumber,
  LiveString,
  LiveTimestamp,
  number,
  reference,
  string,
  timestamp,
} from "../../src/schema/atomic-types";

describe("LiveNumber", () => {
  test("should create a LiveNumber instance", () => {
    const liveNumber = number();
    expect(liveNumber).toBeInstanceOf(LiveNumber);
  });

  test("should encode mutation correctly", () => {
    const liveNumber = number();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = liveNumber.encodeMutation("set", 42, timestamp);

    expect(result).toEqual({
      value: 42,
      _meta: {
        timestamp,
      },
    });
  });

  test("should merge mutation correctly", () => {
    const liveNumber = number();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: 42,
      _meta: {
        timestamp,
      },
    };

    const [newValue, acceptedMutation] = liveNumber.mergeMutation(
      "set",
      encodedMutation
    );

    expect(newValue).toEqual({
      value: 42,
      _meta: {
        timestamp,
      },
    });
    expect(acceptedMutation).toEqual(encodedMutation);
  });

  test("should convert string value to number", () => {
    const liveNumber = number();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: "42",
      _meta: {
        timestamp,
      },
    };

    const [newValue] = liveNumber.mergeMutation("set", encodedMutation as any);

    expect(newValue.value).toBe(42);
    expect(typeof newValue.value).toBe("number");
  });

  test("should not merge if materialized shape has newer timestamp", () => {
    const liveNumber = number();
    const olderTimestamp = "2023-01-01T00:00:00.000Z";
    const newerTimestamp = "2023-01-02T00:00:00.000Z";

    const materializedShape = {
      value: 100,
      _meta: {
        timestamp: newerTimestamp,
      },
    };

    const encodedMutation = {
      value: 42,
      _meta: {
        timestamp: olderTimestamp,
      },
    };

    const [newValue, acceptedMutation] = liveNumber.mergeMutation(
      "set",
      encodedMutation,
      materializedShape
    );

    expect(newValue).toEqual(materializedShape);
    expect(acceptedMutation).toBeNull();
  });

  test("should return correct storage field type", () => {
    const liveNumber = number();
    const storageType = liveNumber.getStorageFieldType();

    expect(storageType).toEqual({
      type: "integer",
      nullable: false,
      index: false,
      unique: false,
      primary: false,
    });
  });

  test("should create indexed field", () => {
    const liveNumber = number().index();
    const storageType = liveNumber.getStorageFieldType();

    expect(storageType.index).toBe(true);
  });

  test("should create unique field", () => {
    const liveNumber = number().unique();
    const storageType = liveNumber.getStorageFieldType();

    expect(storageType.unique).toBe(true);
  });

  test("should create field with default value", () => {
    const defaultValue = 100;
    const liveNumber = number().default(defaultValue);
    const storageType = liveNumber.getStorageFieldType();

    expect(storageType.default).toBe(defaultValue);
  });

  test("should create primary field", () => {
    const liveNumber = number().primary();
    const storageType = liveNumber.getStorageFieldType();

    expect(storageType.primary).toBe(true);
  });

  test("should create optional field", () => {
    const liveNumber = number().optional();
    const storageType = liveNumber.getStorageFieldType();

    expect(storageType.nullable).toBe(true);
  });
});

describe("LiveString", () => {
  test("should create a LiveString instance", () => {
    const liveString = string();
    expect(liveString).toBeInstanceOf(LiveString);
  });

  test("should create an ID field", () => {
    const idField = id();
    const storageType = idField.getStorageFieldType();

    expect(storageType).toEqual({
      type: "varchar",
      nullable: false,
      index: true,
      unique: true,
      primary: true,
    });
  });

  test("should create a reference field", () => {
    const refField = reference("users.id");
    const storageType = refField.getStorageFieldType();

    expect(storageType).toEqual({
      type: "varchar",
      nullable: false,
      index: false,
      unique: false,
      primary: false,
      references: "users.id",
    });
  });

  test("should encode mutation correctly", () => {
    const liveString = string();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = liveString.encodeMutation("set", "test", timestamp);

    expect(result).toEqual({
      value: "test",
      _meta: {
        timestamp,
      },
    });
  });

  test("should merge mutation correctly", () => {
    const liveString = string();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: "test",
      _meta: {
        timestamp,
      },
    };

    const [newValue, acceptedMutation] = liveString.mergeMutation(
      "set",
      encodedMutation
    );

    expect(newValue).toEqual(encodedMutation);
    expect(acceptedMutation).toEqual(encodedMutation);
  });
});

describe("LiveBoolean", () => {
  test("should create a LiveBoolean instance", () => {
    const liveBoolean = boolean();
    expect(liveBoolean).toBeInstanceOf(LiveBoolean);
  });

  test("should encode mutation correctly", () => {
    const liveBoolean = boolean();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = liveBoolean.encodeMutation("set", true, timestamp);

    expect(result).toEqual({
      value: true,
      _meta: {
        timestamp,
      },
    });
  });

  test("should convert string 'true' to boolean true", () => {
    const liveBoolean = boolean();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: "true",
      _meta: {
        timestamp,
      },
    };

    const [newValue] = liveBoolean.mergeMutation("set", encodedMutation as any);

    expect(newValue.value).toBe(true);
    expect(typeof newValue.value).toBe("boolean");
  });

  test("should convert string 'false' to boolean false", () => {
    const liveBoolean = boolean();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: "false",
      _meta: {
        timestamp,
      },
    };

    const [newValue] = liveBoolean.mergeMutation("set", encodedMutation as any);

    expect(newValue.value).toBe(false);
    expect(typeof newValue.value).toBe("boolean");
  });

  test("should convert truthy values to boolean true", () => {
    const liveBoolean = boolean();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: 1,
      _meta: {
        timestamp,
      },
    };

    const [newValue] = liveBoolean.mergeMutation("set", encodedMutation as any);

    expect(newValue.value).toBe(true);
    expect(typeof newValue.value).toBe("boolean");
  });

  test("should convert falsy values to boolean false", () => {
    const liveBoolean = boolean();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: 0,
      _meta: {
        timestamp,
      },
    };

    const [newValue] = liveBoolean.mergeMutation("set", encodedMutation as any);

    expect(newValue.value).toBe(false);
    expect(typeof newValue.value).toBe("boolean");
  });
});

describe("LiveTimestamp", () => {
  test("should create a LiveTimestamp instance", () => {
    const liveTimestamp = timestamp();
    expect(liveTimestamp).toBeInstanceOf(LiveTimestamp);
  });

  test("should encode mutation correctly", () => {
    const liveTimestamp = timestamp();
    const now = new Date();
    const timestampStr = "2023-01-01T00:00:00.000Z";
    const result = liveTimestamp.encodeMutation("set", now, timestampStr);

    expect(result).toEqual({
      value: now,
      _meta: {
        timestamp: timestampStr,
      },
    });
  });

  test("should convert string to Date", () => {
    const liveTimestamp = timestamp();
    const dateStr = "2023-01-01T00:00:00.000Z";
    const timestampStr = "2023-01-02T00:00:00.000Z";
    const encodedMutation = {
      value: dateStr,
      _meta: {
        timestamp: timestampStr,
      },
    };

    const [newValue] = liveTimestamp.mergeMutation(
      "set",
      encodedMutation as any
    );

    expect(newValue.value).toBeInstanceOf(Date);
    expect(newValue.value.toISOString()).toBe(dateStr);
  });

  test("should keep Date object as is", () => {
    const liveTimestamp = timestamp();
    const date = new Date("2023-01-01T00:00:00.000Z");
    const timestampStr = "2023-01-02T00:00:00.000Z";
    const encodedMutation = {
      value: date,
      _meta: {
        timestamp: timestampStr,
      },
    };

    const [newValue] = liveTimestamp.mergeMutation("set", encodedMutation);

    expect(newValue.value).toBe(date);
    expect(newValue.value).toBeInstanceOf(Date);
  });
});

describe("OptionalLiveType", () => {
  test("should create an optional field", () => {
    const optionalNumber = number().optional();
    const storageType = optionalNumber.getStorageFieldType();

    expect(storageType.nullable).toBe(true);
  });

  test("should encode mutation correctly", () => {
    const optionalNumber = number().optional();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = optionalNumber.encodeMutation("set", 42, timestamp);

    expect(result).toEqual({
      value: 42,
      _meta: {
        timestamp,
      },
    });
  });

  test("should encode undefined mutation correctly", () => {
    const optionalNumber = number().optional();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = optionalNumber.encodeMutation("set", undefined, timestamp);

    expect(result).toEqual({
      value: undefined,
      _meta: {
        timestamp,
      },
    });
  });

  test("should merge mutation correctly", () => {
    const optionalNumber = number().optional();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: 42,
      _meta: {
        timestamp,
      },
    };

    const [newValue, acceptedMutation] = optionalNumber.mergeMutation(
      "set",
      encodedMutation
    );

    expect(newValue.value).toBe(42);
    expect(acceptedMutation).toEqual(encodedMutation);
  });
});
