import { Kysely, PostgresDialect } from "kysely";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  Mock,
  test,
  vi,
} from "vitest";
import { LiveObjectAny, MaterializedLiveType, Schema } from "../../src/schema";
import { SQLStorage, Storage } from "../../src/server/storage";

// Mock Kysely and PostgresDialect
vi.mock("kysely", () => ({
  Kysely: vi.fn(),
  PostgresDialect: vi.fn(),
}));

vi.mock("kysely/helpers/postgres", () => ({
  jsonArrayFrom: vi.fn((query) => ({ as: vi.fn() })),
  jsonObjectFrom: vi.fn((query) => ({ as: vi.fn() })),
}));

describe("Storage", () => {
  test("should define abstract methods", () => {
    const storage = new (class extends Storage {
      async updateSchema() {}
      async rawFindById() {
        return undefined;
      }
      async findOne() {
        return undefined;
      }
      async rawFind() {
        return {};
      }
      async find() {
        return {};
      }
      async rawUpsert() {
        return {} as any;
      }
    })();

    expect(typeof storage.updateSchema).toBe("function");
    expect(typeof storage.rawFindById).toBe("function");
    expect(typeof storage.findOne).toBe("function");
    expect(typeof storage.rawFind).toBe("function");
    expect(typeof storage.find).toBe("function");
    expect(typeof storage.rawUpsert).toBe("function");
  });

  test("should implement insert method", async () => {
    const mockRawUpsert = vi.fn().mockResolvedValue({
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    });

    const storage = new (class extends Storage {
      async updateSchema() {}
      async rawFindById() {
        return undefined;
      }
      async findOne() {
        return undefined;
      }
      async rawFind() {
        return {};
      }
      async find() {
        return {};
      }
      rawUpsert = mockRawUpsert;
    })();

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockValue = { id: "test-id", name: "John" };

    const result = await storage.insert(mockResource, mockValue);

    expect(mockRawUpsert).toHaveBeenCalledWith(
      "users",
      "test-id",
      expect.objectContaining({
        value: expect.objectContaining({
          id: expect.objectContaining({ value: "test-id" }),
          name: expect.objectContaining({
            value: "John",
            _meta: expect.objectContaining({ timestamp: expect.any(String) }),
          }),
        }),
      })
    );
    expect(result).toEqual({ id: "test-id", name: "John" });
  });

  test("should implement update method", async () => {
    const mockRawUpsert = vi.fn().mockResolvedValue({
      value: {
        name: {
          value: "Jane",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    });

    const storage = new (class extends Storage {
      async updateSchema() {}
      async rawFindById() {
        return undefined;
      }
      async findOne() {
        return undefined;
      }
      async rawFind() {
        return {};
      }
      async find() {
        return {};
      }
      rawUpsert = mockRawUpsert;
    })();

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockValue = { id: "test-id", name: "Jane" };

    const result = await storage.update(mockResource, "test-id", mockValue);

    expect(mockRawUpsert).toHaveBeenCalledWith(
      "users",
      "test-id",
      expect.objectContaining({
        value: expect.objectContaining({
          name: expect.objectContaining({
            value: "Jane",
            _meta: expect.objectContaining({ timestamp: expect.any(String) }),
          }),
        }),
      })
    );
    expect(result).toEqual({ name: "Jane" });
  });
});

describe("SQLStorage", () => {
  let storage: SQLStorage;
  let mockDb: any;
  let mockPool: any;

  beforeEach(() => {
    mockDb = {
      introspection: {
        getTables: vi.fn().mockResolvedValue([]),
      },
      schema: {
        createTable: vi.fn().mockReturnValue({
          ifNotExists: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        alterTable: vi.fn().mockReturnValue({
          addColumn: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        createIndex: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnValue({
            column: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      },
      selectFrom: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation((fn) =>
          fn({
            selectFrom: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            executeTakeFirst: vi.fn().mockResolvedValue(undefined),
            updateTable: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue(undefined),
            insertInto: vi.fn().mockReturnThis(),
            values: vi.fn().mockReturnThis(),
          })
        ),
      }),
    };

    mockPool = {};

    (Kysely as Mock).mockImplementation(() => mockDb);
    (PostgresDialect as Mock).mockImplementation(() => ({}));

    storage = new SQLStorage(mockPool);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create SQLStorage instance", () => {
    expect(storage).toBeInstanceOf(SQLStorage);
    expect(Kysely).toHaveBeenCalledWith({
      dialect: expect.any(Object),
    });
    expect(PostgresDialect).toHaveBeenCalledWith({
      pool: mockPool,
    });
  });

  test("should update schema and create tables", async () => {
    const mockSchema: Schema<any> = {
      users: {
        name: "users",
        fields: {
          id: {
            getStorageFieldType: () => ({
              type: "varchar",
              primary: true,
              nullable: false,
            }),
          },
          name: {
            getStorageFieldType: () => ({
              type: "varchar",
              nullable: true,
            }),
          },
        },
        relations: {},
      },
    };

    mockDb.introspection.getTables.mockResolvedValue([]);

    await storage.updateSchema(mockSchema);

    expect(mockDb.schema.createTable).toHaveBeenCalledWith("users");
    expect(mockDb.schema.createTable).toHaveBeenCalledWith("users_meta");
  });

  test("should add columns when they don't exist", async () => {
    const mockSchema: Schema<any> = {
      users: {
        name: "users",
        fields: {
          name: {
            getStorageFieldType: () => ({
              type: "varchar",
              nullable: false,
              unique: true,
              index: true,
            }),
          },
        },
        relations: {},
      },
    };

    mockDb.introspection.getTables.mockResolvedValue([
      {
        name: "users",
        columns: [],
      },
      {
        name: "users_meta",
        columns: [],
      },
    ]);

    const mockAlterTable = {
      addColumn: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    };

    mockDb.schema.alterTable.mockReturnValue(mockAlterTable);

    await storage.updateSchema(mockSchema);

    expect(mockDb.schema.alterTable).toHaveBeenCalledWith("users");
    expect(mockAlterTable.addColumn).toHaveBeenCalledWith(
      "name",
      "varchar",
      expect.any(Function)
    );
  });

  test("should handle rawFindById", async () => {
    const mockRawValue = {
      id: "test-id",
      name: "John",
      _meta: { name: "2023-01-01T00:00:00.000Z" },
    };

    mockDb.executeTakeFirst.mockResolvedValue(mockRawValue);

    const result = await storage.rawFindById("users", "test-id");

    expect(mockDb.selectFrom).toHaveBeenCalledWith("users");
    expect(mockDb.where).toHaveBeenCalledWith("id", "=", "test-id");
    expect(result).toEqual({
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    });
  });

  test("should return undefined when rawFindById finds no result", async () => {
    mockDb.executeTakeFirst.mockResolvedValue(undefined);

    const result = await storage.rawFindById("users", "nonexistent");

    expect(result).toBeUndefined();
  });

  test("should handle findOne", async () => {
    const mockResource = { name: "users" } as LiveObjectAny;
    const mockRawValue = {
      id: "test-id",
      name: "John",
      _meta: { name: "2023-01-01T00:00:00.000Z" },
    };

    mockDb.executeTakeFirst.mockResolvedValue(mockRawValue);

    const result = await storage.findOne(mockResource, "test-id");

    expect(result).toEqual({ id: "test-id", name: "John" });
  });

  test("should return undefined when findOne finds no result", async () => {
    const mockResource = { name: "users" } as LiveObjectAny;
    mockDb.executeTakeFirst.mockResolvedValue(undefined);

    const result = await storage.findOne(mockResource, "nonexistent");

    expect(result).toBeUndefined();
  });

  test("should handle rawFind", async () => {
    const mockRawResult = [
      {
        id: "user1",
        name: "John",
        _meta: { name: "2023-01-01T00:00:00.000Z" },
      },
      {
        id: "user2",
        name: "Jane",
        _meta: { name: "2023-01-01T00:00:00.000Z" },
      },
    ];

    mockDb.execute.mockResolvedValue(mockRawResult);

    const result = await storage.rawFind("users");

    expect(mockDb.selectFrom).toHaveBeenCalledWith("users");
    expect(result).toEqual({
      user1: {
        value: {
          name: {
            value: "John",
            _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
          },
        },
      },
      user2: {
        value: {
          name: {
            value: "Jane",
            _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
          },
        },
      },
    });
  });

  test("should return empty object when rawFind finds no results", async () => {
    mockDb.execute.mockResolvedValue([]);

    const result = await storage.rawFind("users");

    expect(result).toEqual({});
  });

  test("should handle find", async () => {
    const mockResource = { name: "users" } as LiveObjectAny;
    const mockRawResult = [
      {
        id: "user1",
        name: "John",
        _meta: { name: "2023-01-01T00:00:00.000Z" },
      },
    ];

    mockDb.execute.mockResolvedValue(mockRawResult);

    const result = await storage.find(mockResource);

    expect(result).toEqual({
      user1: { name: "John" },
    });
  });

  test("should handle rawUpsert for new record", async () => {
    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    };

    // Mock transaction to simulate new record (no existing record found)
    const mockTrx = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined), // No existing record
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };

    mockDb.transaction.mockReturnValue({
      execute: vi.fn().mockImplementation((fn) => fn(mockTrx)),
    });

    const result = await storage.rawUpsert("users", "test-id", mockValue);

    expect(mockTrx.insertInto).toHaveBeenCalledWith("users");
    expect(mockTrx.insertInto).toHaveBeenCalledWith("users_meta");
    expect(result).toEqual(mockValue);
  });

  test("should handle rawUpsert for existing record", async () => {
    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    };

    // Mock transaction to simulate existing record
    const mockTrx = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ id: "test-id" }), // Existing record
      updateTable: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };

    mockDb.transaction.mockReturnValue({
      execute: vi.fn().mockImplementation((fn) => fn(mockTrx)),
    });

    const result = await storage.rawUpsert("users", "test-id", mockValue);

    expect(mockTrx.updateTable).toHaveBeenCalledWith("users");
    expect(mockTrx.updateTable).toHaveBeenCalledWith("users_meta");
    expect(result).toEqual(mockValue);
  });

  test("should throw error when convertToMaterializedLiveType receives value without _meta", () => {
    const value = { id: "test-id", name: "John" };

    expect(() => (storage as any).convertToMaterializedLiveType(value)).toThrow(
      "Missing _meta"
    );
  });

  test("should handle convertToMaterializedLiveType with nested objects", () => {
    const value = {
      id: "test-id",
      profile: {
        name: "John",
        age: 30,
        _meta: {
          name: "2023-01-01T00:00:00.000Z",
          age: "2023-01-01T00:00:00.000Z",
        },
      },
      _meta: {},
    };

    const result = (storage as any).convertToMaterializedLiveType(value);

    expect(result).toEqual({
      value: {
        id: { value: "test-id" },
        profile: {
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
          _meta: {},
        },
      },
    });
  });

  test("should handle convertToMaterializedLiveType with arrays", () => {
    const value = {
      id: "test-id",
      tags: [
        { name: "tag1", _meta: { timestamp: "2023-01-01T00:00:00.000Z" } },
        { name: "tag2", _meta: { timestamp: "2023-01-01T00:00:00.000Z" } },
      ],
      _meta: {
        tags: "2023-01-01T00:00:00.000Z",
      },
    };

    const result = (storage as any).convertToMaterializedLiveType(value);

    expect(result.value.tags.value).toHaveLength(2);
    expect(result.value.tags._meta.timestamp).toBe("2023-01-01T00:00:00.000Z");
  });
});
