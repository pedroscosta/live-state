import { describe, expect, test } from "vitest";
import {
  LiveType,
  BaseMeta,
  MutationType,
  StorageFieldType,
  MaterializedLiveType,
} from "../../src/schema/types";

// Create a concrete implementation of LiveType for testing
class TestLiveType extends LiveType<
  string,
  BaseMeta & { timestamp: string | null },
  string,
  { value: string; _meta: BaseMeta & { timestamp: string | null } }
> {
  encodeMutation(
    mutationType: MutationType,
    input: string,
    timestamp: string,
  ): { value: string; _meta: BaseMeta & { timestamp: string | null } } {
    return {
      value: input,
      _meta: {
        timestamp,
      },
    };
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: {
      value: string;
      _meta: BaseMeta & { timestamp: string | null };
    },
    materializedShape?: MaterializedLiveType<
      LiveType<string, BaseMeta & { timestamp: string | null }>
    >,
  ): [
    MaterializedLiveType<
      LiveType<string, BaseMeta & { timestamp: string | null }>
    >,
    { value: string; _meta: BaseMeta & { timestamp: string | null } } | null,
  ] {
    if (
      materializedShape &&
      materializedShape._meta.timestamp &&
      encodedMutation._meta.timestamp &&
      materializedShape._meta.timestamp.localeCompare(
        encodedMutation._meta.timestamp,
      ) > 0
    ) {
      return [materializedShape, null];
    }

    return [encodedMutation, encodedMutation];
  }

  getStorageFieldType(): StorageFieldType {
    return {
      type: "varchar",
      nullable: false,
    };
  }
}

describe("LiveType", () => {
  test("should create a LiveType instance", () => {
    const liveType = new TestLiveType();
    expect(liveType).toBeInstanceOf(LiveType);
  });

  test("should encode mutation correctly", () => {
    const liveType = new TestLiveType();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const result = liveType.encodeMutation("set", "test", timestamp);

    expect(result).toEqual({
      value: "test",
      _meta: {
        timestamp,
      },
    });
  });

  test("should merge mutation correctly", () => {
    const liveType = new TestLiveType();
    const timestamp = "2023-01-01T00:00:00.000Z";
    const encodedMutation = {
      value: "test",
      _meta: {
        timestamp,
      },
    };

    const [newValue, acceptedMutation] = liveType.mergeMutation(
      "set",
      encodedMutation,
    );

    expect(newValue).toEqual(encodedMutation);
    expect(acceptedMutation).toEqual(encodedMutation);
  });

  test("should not merge if materialized shape has newer timestamp", () => {
    const liveType = new TestLiveType();
    const olderTimestamp = "2023-01-01T00:00:00.000Z";
    const newerTimestamp = "2023-01-02T00:00:00.000Z";

    const materializedShape = {
      value: "old",
      _meta: {
        timestamp: newerTimestamp,
      },
    };

    const encodedMutation = {
      value: "new",
      _meta: {
        timestamp: olderTimestamp,
      },
    };

    const [newValue, acceptedMutation] = liveType.mergeMutation(
      "set",
      encodedMutation,
      materializedShape,
    );

    expect(newValue).toEqual(materializedShape);
    expect(acceptedMutation).toBeNull();
  });

  test("should merge when timestamps are equal", () => {
    const liveType = new TestLiveType();
    const timestamp = "2023-01-01T00:00:00.000Z";

    const materializedShape = {
      value: "current",
      _meta: {
        timestamp,
      },
    };

    const encodedMutation = {
      value: "updated",
      _meta: {
        timestamp,
      },
    };

    const [newValue, acceptedMutation] = liveType.mergeMutation(
      "set",
      encodedMutation,
      materializedShape,
    );

    expect(newValue).toEqual(encodedMutation);
    expect(acceptedMutation).toEqual(encodedMutation);
  });

  test("should return correct storage field type", () => {
    const liveType = new TestLiveType();
    const storageType = liveType.getStorageFieldType();

    expect(storageType).toEqual({
      type: "varchar",
      nullable: false,
    });
  });
});

describe("StorageFieldType", () => {
  test("should have correct structure", () => {
    const storageFieldType: StorageFieldType = {
      type: "varchar",
      nullable: false,
      default: "default",
      unique: true,
      index: true,
      primary: true,
      references: "table.column",
    };

    expect(storageFieldType.type).toBe("varchar");
    expect(storageFieldType.nullable).toBe(false);
    expect(storageFieldType.default).toBe("default");
    expect(storageFieldType.unique).toBe(true);
    expect(storageFieldType.index).toBe(true);
    expect(storageFieldType.primary).toBe(true);
    expect(storageFieldType.references).toBe("table.column");
  });
});
