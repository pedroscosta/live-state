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
      async rawInsert() {
        return {} as any;
      }
      async rawUpdate() {
        return {} as any;
      }
      async transaction() {
        return {} as any;
      }
    })();

    expect(typeof storage.updateSchema).toBe("function");
    expect(typeof storage.rawFindById).toBe("function");
    expect(typeof storage.findOne).toBe("function");
    expect(typeof storage.rawFind).toBe("function");
    expect(typeof storage.find).toBe("function");
    expect(typeof storage.rawInsert).toBe("function");
    expect(typeof storage.rawUpdate).toBe("function");
    expect(typeof storage.transaction).toBe("function");
  });

  test("should implement insert method", async () => {
    const mockRawInsert = vi.fn().mockResolvedValue({
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
      rawInsert = mockRawInsert;
      async rawUpdate() {
        return {} as any;
      }
      async transaction() {
        return {} as any;
      }
    })();

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockValue = { id: "test-id", name: "John" };

    const result = await storage.insert(mockResource, mockValue);

    expect(mockRawInsert).toHaveBeenCalledWith(
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
    const mockRawUpdate = vi.fn().mockResolvedValue({
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
      async rawInsert() {
        return {} as any;
      }
      rawUpdate = mockRawUpdate;
      async transaction() {
        return {} as any;
      }
    })();

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockValue = { id: "test-id", name: "Jane" };

    const result = await storage.update(mockResource, "test-id", mockValue);

    expect(mockRawUpdate).toHaveBeenCalledWith(
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

  test("should handle insert method with complex nested data", async () => {
    const mockRawInsert = vi.fn().mockResolvedValue({
      value: {
        id: { value: "test-id" },
        profile: {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
            settings: {
              value: {
                theme: {
                  value: "dark",
                  _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
                },
              },
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
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
      rawInsert = mockRawInsert;
      async rawUpdate() {
        return {} as any;
      }
      async transaction() {
        return {} as any;
      }
    })();

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockValue = {
      id: "test-id",
      profile: {
        name: "John",
        settings: {
          theme: "dark",
        },
      },
    };

    const result = await storage.insert(mockResource, mockValue);

    expect(mockRawInsert).toHaveBeenCalledWith(
      "users",
      "test-id",
      expect.objectContaining({
        value: expect.objectContaining({
          id: expect.objectContaining({
            value: "test-id",
            _meta: expect.objectContaining({ timestamp: expect.any(String) }),
          }),
          profile: expect.objectContaining({
            value: expect.objectContaining({
              name: "John",
              settings: expect.objectContaining({
                theme: "dark",
              }),
            }),
            _meta: expect.objectContaining({ timestamp: expect.any(String) }),
          }),
        }),
      })
    );
    expect(result).toEqual({
      id: "test-id",
      profile: {
        name: "John",
        settings: {
          theme: "dark",
        },
      },
    });
  });

  test("should handle update method excluding id field", async () => {
    const mockRawUpdate = vi.fn().mockResolvedValue({
      value: {
        name: {
          value: "Jane",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
        email: {
          value: "jane@example.com",
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
      async rawInsert() {
        return {} as any;
      }
      rawUpdate = mockRawUpdate;
      async transaction() {
        return {} as any;
      }
    })();

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockValue = {
      id: "test-id",
      name: "Jane",
      email: "jane@example.com",
    };

    const result = await storage.update(mockResource, "test-id", mockValue);

    expect(mockRawUpdate).toHaveBeenCalledWith(
      "users",
      "test-id",
      expect.objectContaining({
        value: expect.objectContaining({
          name: expect.objectContaining({
            value: "Jane",
            _meta: expect.objectContaining({ timestamp: expect.any(String) }),
          }),
          email: expect.objectContaining({
            value: "jane@example.com",
            _meta: expect.objectContaining({ timestamp: expect.any(String) }),
          }),
        }),
      })
    );
    expect(result).toEqual({ name: "Jane", email: "jane@example.com" });
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
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
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
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

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
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    mockDb.executeTakeFirst.mockResolvedValue(undefined);

    const result = await storage.rawFindById("users", "nonexistent");

    expect(result).toBeUndefined();
  });

  test("should handle findOne", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

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
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    const mockResource = { name: "users" } as LiveObjectAny;
    mockDb.executeTakeFirst.mockResolvedValue(undefined);

    const result = await storage.findOne(mockResource, "nonexistent");

    expect(result).toBeUndefined();
  });

  test("should handle rawFind", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

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
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    mockDb.execute.mockResolvedValue([]);

    const result = await storage.rawFind("users");

    expect(result).toEqual({});
  });

  test("should handle find", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

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

  test("should handle rawInsert", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    };

    // Mock insertInto chain for both tables
    const mockInsertInto = {
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.insertInto.mockReturnValue(mockInsertInto);

    const result = await storage.rawInsert("users", "test-id", mockValue);

    expect(mockDb.insertInto).toHaveBeenCalledWith("users");
    expect(mockInsertInto.values).toHaveBeenCalledWith({
      name: "John",
      id: "test-id",
    });
    expect(result).toEqual(mockValue);
  });

  test("should handle rawUpdate", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    };

    // Mock updateTable chain for both tables
    const mockUpdateTable = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.updateTable.mockReturnValue(mockUpdateTable);

    const result = await storage.rawUpdate("users", "test-id", mockValue);

    expect(mockDb.updateTable).toHaveBeenCalledWith("users");
    expect(mockDb.updateTable).toHaveBeenCalledWith("users_meta");
    expect(mockUpdateTable.set).toHaveBeenCalledWith({ name: "John" });
    expect(mockUpdateTable.set).toHaveBeenCalledWith({
      name: "2023-01-01T00:00:00.000Z",
    });
    expect(mockUpdateTable.where).toHaveBeenCalledWith("id", "=", "test-id");
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

  test("should handle transaction with commit", async () => {
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    const mockTrx = {
      commit: vi
        .fn()
        .mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) }),
      rollback: vi
        .fn()
        .mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) }),
      isCommitted: false,
      isRolledBack: false,
    };

    mockDb.transaction.mockReturnValue({
      execute: vi.fn().mockImplementation(async (fn) => {
        const result = await fn({
          selectFrom: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          executeTakeFirst: vi.fn().mockResolvedValue(undefined),
          updateTable: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue(undefined),
          insertInto: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
        });
        return result;
      }),
    });

    // Mock startTransaction
    mockDb.startTransaction = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockTrx),
    });

    const result = await storage.transaction(async ({ trx, commit }) => {
      await commit();
      return "success";
    });

    expect(result).toBe("success");
    expect(mockDb.startTransaction).toHaveBeenCalled();
  });

  test("should handle transaction with rollback on error", async () => {
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    const mockTrx = {
      commit: vi
        .fn()
        .mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) }),
      rollback: vi
        .fn()
        .mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) }),
      isCommitted: false,
      isRolledBack: false,
    };

    // Mock startTransaction
    mockDb.startTransaction = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockTrx),
    });

    await expect(
      storage.transaction(async () => {
        throw new Error("Transaction error");
      })
    ).rejects.toThrow("Transaction error");

    expect(mockTrx.rollback).toHaveBeenCalled();
  });

  test("should throw error when schema not initialized for rawFindById", async () => {
    const storageWithoutSchema = new SQLStorage(mockPool);

    await expect(
      storageWithoutSchema.rawFindById("users", "test-id")
    ).rejects.toThrow("Schema not initialized");
  });

  test("should throw error when schema not initialized for rawFind", async () => {
    const storageWithoutSchema = new SQLStorage(mockPool);

    await expect(storageWithoutSchema.rawFind("users")).rejects.toThrow(
      "Schema not initialized"
    );
  });

  test("should throw error when schema not initialized for transaction", async () => {
    const storageWithoutSchema = new SQLStorage(mockPool);

    await expect(
      storageWithoutSchema.transaction(async () => "test")
    ).rejects.toThrow("Schema not initialized");
  });

  test("should handle rawFind with where clause", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

    const mockRawResult = [
      {
        id: "user1",
        name: "John",
        _meta: { name: "2023-01-01T00:00:00.000Z" },
      },
    ];

    mockDb.execute.mockResolvedValue(mockRawResult);

    const result = await storage.rawFind("users", { name: "John" });

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
    });
  });

  test("should handle rawFind with include clause", async () => {
    // Initialize schema first
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
        relations: {
          posts: {
            type: "many",
            entity: { name: "posts" },
            foreignColumn: "userId",
          },
        },
      },
    };
    await storage.updateSchema(mockSchema);

    const mockRawResult = [
      {
        id: "user1",
        name: "John",
        _meta: { name: "2023-01-01T00:00:00.000Z" },
      },
    ];

    mockDb.execute.mockResolvedValue(mockRawResult);

    const result = await storage.rawFind("users", undefined, { posts: true });

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
    });
  });

  test("should handle rawFindById with include clause", async () => {
    // Initialize schema first
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
        relations: {
          posts: {
            type: "many",
            entity: { name: "posts" },
            foreignColumn: "userId",
          },
        },
      },
    };
    await storage.updateSchema(mockSchema);

    const mockRawValue = {
      id: "test-id",
      name: "John",
      _meta: { name: "2023-01-01T00:00:00.000Z" },
    };

    mockDb.executeTakeFirst.mockResolvedValue(mockRawValue);

    const result = await storage.rawFindById("users", "test-id", {
      posts: true,
    });

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

  test("should handle findOne with include options", async () => {
    // Initialize schema first
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
        relations: {
          posts: {
            type: "many",
            entity: { name: "posts" },
            foreignColumn: "userId",
          },
        },
      },
    };
    await storage.updateSchema(mockSchema);

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockRawValue = {
      id: "test-id",
      name: "John",
      _meta: { name: "2023-01-01T00:00:00.000Z" },
    };

    mockDb.executeTakeFirst.mockResolvedValue(mockRawValue);

    const result = await storage.findOne(mockResource, "test-id", {
      include: { posts: true },
    });

    expect(result).toEqual({ id: "test-id", name: "John" });
  });

  test("should handle find with where and include options", async () => {
    // Initialize schema first
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
        relations: {
          posts: {
            type: "many",
            entity: { name: "posts" },
            foreignColumn: "userId",
          },
        },
      },
    };
    await storage.updateSchema(mockSchema);

    const mockResource = { name: "users" } as LiveObjectAny;
    const mockRawResult = [
      {
        id: "user1",
        name: "John",
        _meta: { name: "2023-01-01T00:00:00.000Z" },
      },
    ];

    mockDb.execute.mockResolvedValue(mockRawResult);

    const result = await storage.find(mockResource, {
      where: { name: "John" },
      include: { posts: true },
    });

    expect(result).toEqual({
      user1: { name: "John" },
    });
  });

  test("should handle convertToMaterializedLiveType with Date objects", () => {
    const date = new Date("2023-01-01T00:00:00.000Z");
    const value = {
      id: "test-id",
      createdAt: date,
      _meta: {
        createdAt: "2023-01-01T00:00:00.000Z",
      },
    };

    const result = (storage as any).convertToMaterializedLiveType(value);

    expect(result).toEqual({
      value: {
        id: { value: "test-id" },
        createdAt: {
          value: date,
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    });
  });

  test("should handle convertToMaterializedLiveType with null values", () => {
    const value = {
      id: "test-id",
      description: null,
      _meta: {
        description: "2023-01-01T00:00:00.000Z",
      },
    };

    const result = (storage as any).convertToMaterializedLiveType(value);

    expect(result).toEqual({
      value: {
        id: { value: "test-id" },
        description: {
          value: null,
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    });
  });

  test("should handle rawInsert with fields that have no _meta", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          // No _meta field
        },
      },
    };

    // Mock insertInto chain for both tables
    const mockInsertInto = {
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.insertInto.mockReturnValue(mockInsertInto);

    const result = await storage.rawInsert("users", "test-id", mockValue);

    expect(mockDb.insertInto).toHaveBeenCalledWith("users");
    expect(mockInsertInto.values).toHaveBeenCalledWith({
      id: "test-id",
    });
    expect(result).toEqual(mockValue);
  });

  test("should handle rawUpdate with fields that have no _meta", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          // No _meta field
        },
      },
    };

    // Mock updateTable chain for both tables
    const mockUpdateTable = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.updateTable.mockReturnValue(mockUpdateTable);

    const result = await storage.rawUpdate("users", "test-id", mockValue);

    expect(mockDb.updateTable).toHaveBeenCalledWith("users");
    expect(mockDb.updateTable).toHaveBeenCalledWith("users_meta");
    expect(mockUpdateTable.set).toHaveBeenCalledWith({});
    expect(result).toEqual(mockValue);
  });

  test("should handle updateSchema with existing tables and columns", async () => {
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

    mockDb.introspection.getTables.mockResolvedValue([
      {
        name: "users",
        columns: [
          { name: "id", dataType: "varchar" },
          { name: "name", dataType: "varchar" },
        ],
      },
      {
        name: "users_meta",
        columns: [
          { name: "id", dataType: "varchar" },
          { name: "name", dataType: "varchar" },
        ],
      },
    ]);

    await storage.updateSchema(mockSchema);

    // Should not create tables or add columns since they already exist
    expect(mockDb.schema.createTable).not.toHaveBeenCalled();
    expect(mockDb.schema.alterTable).not.toHaveBeenCalled();
  });

  test("should handle updateSchema with column type mismatch", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
          age: {
            getStorageFieldType: () => ({
              type: "integer",
              nullable: true,
            }),
          },
        },
        relations: {},
      },
    };

    mockDb.introspection.getTables.mockResolvedValue([
      {
        name: "users",
        columns: [
          { name: "id", dataType: "varchar" },
          { name: "age", dataType: "varchar" }, // Wrong type
        ],
      },
      {
        name: "users_meta",
        columns: [
          { name: "id", dataType: "varchar" },
          { name: "age", dataType: "varchar" },
        ],
      },
    ]);

    await storage.updateSchema(mockSchema);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Column type mismatch:",
      "age",
      "expected to have type:",
      "integer",
      "but has type:",
      "varchar"
    );

    consoleSpy.mockRestore();
  });

  test("should handle updateSchema with field that has all storage options", async () => {
    const mockSchema: Schema<any> = {
      users: {
        name: "users",
        fields: {
          email: {
            getStorageFieldType: () => ({
              type: "varchar",
              nullable: false,
              unique: true,
              index: true,
              references: "other_table.id",
              default: "default@example.com",
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

    expect(mockAlterTable.addColumn).toHaveBeenCalledWith(
      "email",
      "varchar",
      expect.any(Function)
    );
    expect(mockDb.schema.createIndex).toHaveBeenCalledWith("users_email_index");
  });

  test("should handle updateSchema with index creation error", async () => {
    const mockSchema: Schema<any> = {
      users: {
        name: "users",
        fields: {
          name: {
            getStorageFieldType: () => ({
              type: "varchar",
              nullable: false,
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
    mockDb.schema.createIndex.mockReturnValue({
      on: vi.fn().mockReturnValue({
        column: vi.fn().mockReturnValue({
          execute: vi
            .fn()
            .mockRejectedValue(new Error("Index creation failed")),
        }),
      }),
    });

    // Should not throw error, just catch and continue
    await expect(storage.updateSchema(mockSchema)).resolves.not.toThrow();
  });

  test("should handle updateSchema with column creation error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockSchema: Schema<any> = {
      users: {
        name: "users",
        fields: {
          name: {
            getStorageFieldType: () => ({
              type: "varchar",
              nullable: false,
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
        execute: vi.fn().mockRejectedValue(new Error("Column creation failed")),
      }),
    };

    mockDb.schema.alterTable.mockReturnValue(mockAlterTable);

    await expect(storage.updateSchema(mockSchema)).rejects.toThrow(
      "Column creation failed"
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      "Error adding column",
      "name",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  test("should handle SQLStorage constructor with Kysely instance", () => {
    const mockKyselyInstance = {} as any;
    const mockSchema = {} as Schema<any>;

    const storageWithKysely = new SQLStorage(mockKyselyInstance, mockSchema);

    expect(storageWithKysely).toBeInstanceOf(SQLStorage);
  });

  test("should handle rawInsert with meta table insert", async () => {
    // Initialize schema first
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
    await storage.updateSchema(mockSchema);

    const mockValue: MaterializedLiveType<any> = {
      value: {
        id: { value: "test-id" },
        name: {
          value: "John",
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      },
    };

    // Mock insertInto chain for both tables
    const mockInsertInto = {
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.insertInto.mockReturnValue(mockInsertInto);

    const result = await storage.rawInsert("users", "test-id", mockValue);

    expect(mockDb.insertInto).toHaveBeenCalledWith("users");
    expect(mockDb.insertInto).toHaveBeenCalledWith("users_meta");
    expect(mockInsertInto.values).toHaveBeenCalledWith({
      name: "John",
      id: "test-id",
    });
    expect(mockInsertInto.values).toHaveBeenCalledWith({
      name: "2023-01-01T00:00:00.000Z",
      id: "test-id",
    });
    expect(result).toEqual(mockValue);
  });

  test("should handle nested transaction when db.isTransaction is true", async () => {
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    // Mock the database to be in a transaction
    const mockControlledTransaction = {
      commit: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollback: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    };

    // Set up the database to simulate being in a transaction
    mockDb.isTransaction = true;
    mockDb.commit = mockControlledTransaction.commit;
    mockDb.rollback = mockControlledTransaction.rollback;

    const mockFn = vi.fn().mockResolvedValue("nested-transaction-result");

    const result = await storage.transaction(mockFn);

    // Verify the function was called with the correct parameters
    expect(mockFn).toHaveBeenCalledWith({
      trx: storage,
      commit: expect.any(Function),
      rollback: expect.any(Function),
    });

    // Verify the result is returned correctly
    expect(result).toBe("nested-transaction-result");

    // Verify commit and rollback functions work
    const { commit, rollback } = mockFn.mock.calls[0][0];

    await commit();
    expect(mockControlledTransaction.commit).toHaveBeenCalled();
    expect(mockControlledTransaction.commit().execute).toHaveBeenCalled();

    await rollback();
    expect(mockControlledTransaction.rollback).toHaveBeenCalled();
    expect(mockControlledTransaction.rollback().execute).toHaveBeenCalled();
  });

  test("should handle nested transaction with commit function", async () => {
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    // Mock the database to be in a transaction
    const mockCommitExecute = vi.fn().mockResolvedValue(undefined);
    const mockControlledTransaction = {
      commit: vi.fn().mockReturnValue({
        execute: mockCommitExecute,
      }),
    };

    mockDb.isTransaction = true;
    mockDb.commit = mockControlledTransaction.commit;

    const result = await storage.transaction(async ({ commit }) => {
      await commit();
      return "committed-result";
    });

    expect(result).toBe("committed-result");
    expect(mockControlledTransaction.commit).toHaveBeenCalled();
    expect(mockCommitExecute).toHaveBeenCalled();
  });

  test("should handle nested transaction with rollback function", async () => {
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    // Mock the database to be in a transaction
    const mockRollbackExecute = vi.fn().mockResolvedValue(undefined);
    const mockControlledTransaction = {
      rollback: vi.fn().mockReturnValue({
        execute: mockRollbackExecute,
      }),
    };

    mockDb.isTransaction = true;
    mockDb.rollback = mockControlledTransaction.rollback;

    const result = await storage.transaction(async ({ rollback }) => {
      await rollback();
      return "rolled-back-result";
    });

    expect(result).toBe("rolled-back-result");
    expect(mockControlledTransaction.rollback).toHaveBeenCalled();
    expect(mockRollbackExecute).toHaveBeenCalled();
  });

  test("should handle nested transaction with error in function", async () => {
    // Initialize schema first
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
        },
        relations: {},
      },
    };
    await storage.updateSchema(mockSchema);

    // Mock the database to be in a transaction
    const mockRollbackExecute = vi.fn().mockResolvedValue(undefined);
    const mockControlledTransaction = {
      rollback: vi.fn().mockReturnValue({
        execute: mockRollbackExecute,
      }),
    };

    mockDb.isTransaction = true;
    mockDb.rollback = mockControlledTransaction.rollback;

    await expect(
      storage.transaction(async () => {
        throw new Error("Nested transaction error");
      })
    ).rejects.toThrow("Nested transaction error");

    // In nested transactions, rollback is not automatically called on error
    // The error is just propagated up
    expect(mockControlledTransaction.rollback).not.toHaveBeenCalled();
  });
});
