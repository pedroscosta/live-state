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
      onConflict: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
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
            onConflict: vi.fn().mockReturnValue({
              column: vi.fn().mockReturnValue({
                doUpdateSet: vi.fn().mockReturnThis(),
              }),
            }),
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
          id: {
            value: "user1",
          },
          name: {
            value: "John",
            _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
          },
        },
      },
      user2: {
        value: {
          id: {
            value: "user2",
          },
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
      user1: { id: "user1", name: "John" },
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
      onConflict: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
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

    // Mock insertInto chain for meta table
    const mockInsertInto = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.insertInto.mockReturnValue(mockInsertInto);

    const result = await storage.rawUpdate("users", "test-id", mockValue);

    expect(mockDb.updateTable).toHaveBeenCalledWith("users");
    expect(mockDb.insertInto).toHaveBeenCalledWith("users_meta");
    expect(mockUpdateTable.set).toHaveBeenCalledWith({ name: "John" });
    expect(mockInsertInto.values).toHaveBeenCalledWith({
      name: "2023-01-01T00:00:00.000Z",
      id: "test-id",
    });
    expect(mockUpdateTable.where).toHaveBeenCalledWith("id", "=", "test-id");
    expect(result).toEqual(mockValue);
  });

  test.skip("should throw error when convertToMaterializedLiveType receives value without _meta", () => {
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
          id: {
            value: "user1",
          },
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
          id: {
            value: "user1",
          },
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
      user1: { id: "user1", name: "John" },
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
      onConflict: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
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

    // Mock insertInto chain for meta table
    const mockInsertInto = {
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    mockDb.insertInto.mockReturnValue(mockInsertInto);

    const result = await storage.rawUpdate("users", "test-id", mockValue);

    expect(mockDb.updateTable).toHaveBeenCalledWith("users");
    expect(mockDb.insertInto).toHaveBeenCalledWith("users_meta");
    expect(mockUpdateTable.set).toHaveBeenCalledWith({});
    expect(mockInsertInto.values).toHaveBeenCalledWith({ id: "test-id" });
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
      onConflict: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
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

    // Mock savepoint operations
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    // Set up the database to simulate being in a transaction
    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

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
    expect(mockSavepoint.releaseSavepoint).toHaveBeenCalled();

    await rollback();
    expect(mockSavepoint.rollbackToSavepoint).toHaveBeenCalled();
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

    // Mock savepoint operations
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    const result = await storage.transaction(async ({ commit }) => {
      await commit();
      return "committed-result";
    });

    expect(result).toBe("committed-result");
    expect(mockSavepoint.releaseSavepoint).toHaveBeenCalled();
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

    // Mock savepoint operations
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    const result = await storage.transaction(async ({ rollback }) => {
      await rollback();
      return "rolled-back-result";
    });

    expect(result).toBe("rolled-back-result");
    expect(mockSavepoint.rollbackToSavepoint).toHaveBeenCalled();
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

    // Mock savepoint operations
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    await expect(
      storage.transaction(async () => {
        throw new Error("Nested transaction error");
      })
    ).rejects.toThrow("Nested transaction error");

    // When an error occurs in nested transaction, savepoint should be rolled back
    expect(mockSavepoint.rollbackToSavepoint).toHaveBeenCalled();
  });

  test("should handle nested transaction with savepoint creation and release", async () => {
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

    // Mock savepoint operations
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    const result = await storage.transaction(
      async ({ trx, commit, rollback }) => {
        // Test that we can call commit and rollback
        await commit();
        await rollback();
        return "nested-result";
      }
    );

    expect(result).toBe("nested-result");
    expect(mockControlledTransaction.savepoint).toHaveBeenCalled();
    expect(mockSavepoint.releaseSavepoint).toHaveBeenCalled();
    expect(mockSavepoint.rollbackToSavepoint).toHaveBeenCalled();
  });

  test("should handle nested transaction with manual commit not affecting outer transaction", async () => {
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

    // Mock savepoint operations for nested transaction
    const mockNestedSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockNestedSavepoint),
    });

    // Test that manual commit in nested transaction doesn't affect outer transaction
    const result = await storage.transaction(async ({ commit }) => {
      // Manually commit the nested transaction (releases savepoint)
      await commit();
      return "nested-committed";
    });

    expect(result).toBe("nested-committed");
    // Verify savepoint was released for the nested transaction
    expect(mockNestedSavepoint.releaseSavepoint).toHaveBeenCalledTimes(2); // Once manually, once automatically
    // Verify the outer transaction remains active
    expect(mockDb.isTransaction).toBe(true);
    // Verify no rollback occurred
    expect(mockNestedSavepoint.rollbackToSavepoint).not.toHaveBeenCalled();
  });

  test("should handle nested transaction with manual rollback not affecting outer transaction", async () => {
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

    // Mock savepoint operations for nested transaction
    const mockNestedSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockNestedSavepoint),
    });

    // Test that manual rollback in nested transaction doesn't affect outer transaction
    const result = await storage.transaction(async ({ rollback }) => {
      // Manually rollback the nested transaction
      await rollback();
      return "nested-rolled-back";
    });

    expect(result).toBe("nested-rolled-back");
    // Verify savepoint was rolled back for the nested transaction
    expect(mockNestedSavepoint.rollbackToSavepoint).toHaveBeenCalledTimes(1);
    // Verify the outer transaction remains active and not rolled back
    expect(mockDb.isTransaction).toBe(true);
    // Verify release savepoint is still called at the end (auto-release after rollback)
    expect(mockNestedSavepoint.releaseSavepoint).toHaveBeenCalled();
  });

  test("should handle nested transaction with error and automatic savepoint rollback", async () => {
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

    // Mock savepoint operations
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    // Test that error in nested transaction triggers automatic savepoint rollback
    await expect(
      storage.transaction(async () => {
        throw new Error("Nested transaction error");
      })
    ).rejects.toThrow("Nested transaction error");

    expect(mockSavepoint.rollbackToSavepoint).toHaveBeenCalled();
    // The outer transaction should still be active
    expect(mockDb.isTransaction).toBe(true);
  });

  test("should handle nested transaction with multiple levels of nesting", async () => {
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

    // Mock savepoint operations for multiple levels
    const mockSavepoint1 = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockSavepoint2 = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi
        .fn()
        .mockReturnValueOnce({
          execute: vi.fn().mockResolvedValue(mockSavepoint1),
        })
        .mockReturnValueOnce({
          execute: vi.fn().mockResolvedValue(mockSavepoint2),
        }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    // Test multiple levels of nesting
    const result = await storage.transaction(async ({ trx }) => {
      const innerResult = await trx.transaction(async ({ trx: innerTrx }) => {
        return "inner-nested-result";
      });
      return `outer-${innerResult}`;
    });

    expect(result).toBe("outer-inner-nested-result");
    expect(mockControlledTransaction.savepoint).toHaveBeenCalledTimes(2);
    expect(mockSavepoint1.releaseSavepoint).toHaveBeenCalled();
    expect(mockSavepoint2.releaseSavepoint).toHaveBeenCalled();
  });

  test("should handle nested transaction with savepoint when transaction is already committed", async () => {
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

    // Mock savepoint operations with already committed transaction
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: true, // Already committed
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    const result = await storage.transaction(async ({ commit }) => {
      await commit();
      return "nested-result";
    });

    expect(result).toBe("nested-result");
    expect(mockSavepoint.releaseSavepoint).toHaveBeenCalled();
    // Should not call releaseSavepoint again since transaction is already committed
    expect(mockSavepoint.releaseSavepoint).toHaveBeenCalledTimes(1);
  });

  test("should handle nested transaction with savepoint when transaction is already rolled back", async () => {
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

    // Mock savepoint operations with already rolled back transaction
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: true, // Already rolled back
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    const result = await storage.transaction(async ({ rollback }) => {
      await rollback();
      return "nested-result";
    });

    expect(result).toBe("nested-result");
    expect(mockSavepoint.rollbackToSavepoint).toHaveBeenCalled();
    // Should not call releaseSavepoint since transaction is already rolled back
    expect(mockSavepoint.releaseSavepoint).not.toHaveBeenCalled();
  });

  test("should handle nested transaction with savepoint error handling", async () => {
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

    // Mock savepoint operations with error
    const mockSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error("Savepoint error")),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    const mockControlledTransaction = {
      savepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(mockSavepoint),
      }),
    };

    mockDb.isTransaction = true;
    mockDb.savepoint = mockControlledTransaction.savepoint;

    // Test that savepoint errors are handled gracefully
    await expect(
      storage.transaction(async ({ commit }) => {
        await commit();
        return "nested-result";
      })
    ).rejects.toThrow("Savepoint error");

    expect(mockSavepoint.releaseSavepoint).toHaveBeenCalled();
  });

  test("should isolate nested transaction from outer transaction - comprehensive scenario", async () => {
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

    // Mock outer transaction
    const mockOuterTrx = {
      commit: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollback: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
      isTransaction: true,
      savepoint: vi.fn(),
    };

    // Mock nested transaction savepoint
    const mockNestedSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    mockOuterTrx.savepoint.mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockNestedSavepoint),
    });

    mockDb.startTransaction = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockOuterTrx),
    });

    // Simulate outer transaction calling nested transaction
    const result = await storage.transaction(async ({ trx }) => {
      // This creates the outer transaction
      // Now create a nested transaction
      const nestedStorage = new SQLStorage(mockOuterTrx as any, mockSchema);

      try {
        await nestedStorage.transaction(async ({ rollback }) => {
          // Simulate some operation in nested transaction
          await rollback(); // Rollback nested transaction
          return "nested-rolled-back";
        });
      } catch (e) {
        // Nested transaction error shouldn't affect outer
      }

      return "outer-completed";
    });

    expect(result).toBe("outer-completed");
    // Outer transaction should be committed (automatically)
    expect(mockOuterTrx.commit).toHaveBeenCalled();
    // Nested savepoint operations should have been called
    expect(mockOuterTrx.savepoint).toHaveBeenCalled();
    // Nested savepoint should have been rolled back
    expect(mockNestedSavepoint.rollbackToSavepoint).toHaveBeenCalled();
    // Nested savepoint should still be released after rollback
    expect(mockNestedSavepoint.releaseSavepoint).toHaveBeenCalled();
  });

  test("should handle nested transaction commit followed by outer transaction rollback", async () => {
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

    // Mock outer transaction
    const mockOuterTrx = {
      commit: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollback: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
      isTransaction: true,
      savepoint: vi.fn(),
    };

    // Mock nested transaction savepoint
    const mockNestedSavepoint = {
      releaseSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      rollbackToSavepoint: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(undefined),
      }),
      isCommitted: false,
      isRolledBack: false,
    };

    mockOuterTrx.savepoint.mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockNestedSavepoint),
    });

    mockDb.startTransaction = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue(mockOuterTrx),
    });

    // Test that nested commit doesn't prevent outer rollback
    await expect(
      storage.transaction(async ({ trx, rollback }) => {
        // Create nested transaction
        const nestedStorage = new SQLStorage(mockOuterTrx as any, mockSchema);

        await nestedStorage.transaction(async ({ commit }) => {
          await commit(); // Commit nested transaction (releases savepoint)
          return "nested-committed";
        });

        // Now throw error to trigger outer transaction rollback
        throw new Error("Outer transaction error");
      })
    ).rejects.toThrow("Outer transaction error");

    // Outer transaction should be rolled back due to error
    expect(mockOuterTrx.rollback).toHaveBeenCalled();
    // Nested savepoint should have been released (committed)
    expect(mockNestedSavepoint.releaseSavepoint).toHaveBeenCalled();
    // Nested savepoint should not be rolled back (it was committed)
    expect(mockNestedSavepoint.rollbackToSavepoint).not.toHaveBeenCalled();
  });
});
