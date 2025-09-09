import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { KVStorage } from "../../../src/client/websocket/storage";
import { DefaultMutationMessage } from "../../../src/core/schemas/web-socket";
import { Schema } from "../../../src/schema";

// Mock IndexedDB
const mockIndexedDB = {
  databases: vi.fn(),
  open: vi.fn(),
};

const mockDB = {
  objectStoreNames: {
    contains: vi.fn(),
  },
  createObjectStore: vi.fn(),
  deleteObjectStore: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  getAll: vi.fn(),
  getAllKeys: vi.fn(),
  getAllRecords: vi.fn(),
};

const mockMetaDB = {
  objectStoreNames: {
    contains: vi.fn(),
  },
  createObjectStore: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  getAll: vi.fn(),
  getAllKeys: vi.fn(),
  getAllRecords: vi.fn(),
};

const mockTransaction = {
  objectStore: vi.fn().mockReturnValue(mockDB),
};

// Mock idb
vi.mock("idb", () => ({
  openDB: vi.fn(),
}));

// Mock hash function
vi.mock("../../../src/utils", () => ({
  hash: vi.fn().mockResolvedValue("mock-hash"),
}));

describe("KVStorage", () => {
  let storage: KVStorage;
  let mockSchema: Schema<any>;

  beforeEach(() => {
    // Clear all mocks first
    vi.clearAllMocks();

    storage = new KVStorage();
    mockSchema = {
      users: {
        name: "users",
        fields: {},
        relations: {},
      } as any,
      posts: {
        name: "posts",
        fields: {},
        relations: {},
      } as any,
    };

    // Setup window mock
    Object.defineProperty(global, "window", {
      value: {
        indexedDB: mockIndexedDB,
        location: {
          reload: vi.fn(),
        },
      },
      writable: true,
    });

    // Reset mock implementations to default behavior
    mockDB.objectStoreNames.contains.mockReturnValue(false);
    mockDB.createObjectStore.mockReturnValue(undefined);
    mockDB.deleteObjectStore.mockReturnValue(undefined);
    mockDB.get.mockResolvedValue(undefined);
    mockDB.put.mockResolvedValue(undefined);
    mockDB.delete.mockResolvedValue(undefined);
    mockDB.getAll.mockResolvedValue([]);
    mockDB.getAllKeys.mockResolvedValue([]);
    mockDB.getAllRecords.mockResolvedValue({});

    mockMetaDB.objectStoreNames.contains.mockReset();
    mockMetaDB.createObjectStore.mockReset();
    mockMetaDB.getAll.mockReset();
    mockMetaDB.getAllKeys.mockReset();
  });

  afterEach(() => {
    // Restore getAllRecords if it was deleted by tests
    if (!(mockDB as any).getAllRecords) {
      (mockDB as any).getAllRecords = vi.fn();
    }
    if (!(mockMetaDB as any).getAllRecords) {
      (mockMetaDB as any).getAllRecords = vi.fn();
    }

    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("should create a KVStorage instance", () => {
    expect(storage).toBeInstanceOf(KVStorage);
  });

  test("should return early if window is undefined", async () => {
    Object.defineProperty(global, "window", {
      value: undefined,
      writable: true,
    });

    await storage.init(mockSchema, "test-db");

    expect(mockIndexedDB.databases).not.toHaveBeenCalled();
  });

  test("should initialize database with correct version", async () => {
    const { openDB } = await import("idb");
    const mockOpenDB = openDB as any;

    mockIndexedDB.databases.mockResolvedValue([
      { name: "test-db", version: 2 },
    ]);

    // Setup meta DB with no existing data
    mockMetaDB.objectStoreNames.contains.mockReturnValue(true);
    mockMetaDB.getAll.mockResolvedValue([]);
    mockMetaDB.getAllKeys.mockResolvedValue([]);

    mockOpenDB.mockImplementation(
      (name: string, version: number, options: any) => {
        if (name === "live-state-databases") {
          return Promise.resolve(mockMetaDB);
        } else if (name === "test-db") {
          return Promise.resolve(mockDB);
        }
        return Promise.resolve(mockDB);
      }
    );

    await storage.init(mockSchema, "test-db");

    expect(mockOpenDB).toHaveBeenCalledWith(
      "live-state-databases",
      1,
      expect.any(Object)
    );
    expect(mockOpenDB).toHaveBeenCalledWith("test-db", 2, expect.any(Object));
  });

  test("should increment version when schema hash changes", async () => {
    const { openDB } = await import("idb");
    const mockOpenDB = openDB as any;

    mockIndexedDB.databases.mockResolvedValue([
      { name: "test-db", version: 1 },
    ]);

    // Setup meta DB with existing data that has different hash
    mockMetaDB.objectStoreNames.contains.mockReturnValue(true);
    mockMetaDB.getAllRecords.mockResolvedValue({
      "test-db": {
        schemaHash: "old-hash",
        objectHashes: { users: "old-user-hash" },
      },
    });
    mockMetaDB.getAllKeys.mockResolvedValue(["test-db"]);

    mockOpenDB.mockImplementation(
      (name: string, version: number, options: any) => {
        console.log("openDB", name, version, options);
        if (name === "live-state-databases") {
          return Promise.resolve(mockMetaDB);
        } else if (name === "test-db") {
          return Promise.resolve(mockDB);
        }
        return Promise.resolve(mockDB);
      }
    );

    await storage.init(mockSchema, "test-db");

    expect(mockOpenDB).toHaveBeenCalledWith("test-db", 2, expect.any(Object));
  });

  test("should handle database upgrade correctly", async () => {
    const { openDB } = await import("idb");
    const mockOpenDB = openDB as any;

    vi.resetAllMocks();
    vi.clearAllMocks();

    mockIndexedDB.databases.mockResolvedValue([]);

    // Setup meta DB mock
    mockMetaDB.objectStoreNames.contains.mockReturnValue(false);
    mockMetaDB.getAll.mockResolvedValue([]);
    mockMetaDB.getAllKeys.mockResolvedValue([]);

    // Setup main DB mock
    mockDB.objectStoreNames.contains.mockReturnValue(false);

    let metaUpgradeCalled = false;
    let mainUpgradeCalled = false;

    mockOpenDB.mockImplementation((name: any, version: any, options: any) => {
      if (name === "live-state-databases") {
        if (options?.upgrade && !metaUpgradeCalled) {
          options.upgrade(mockMetaDB);
          metaUpgradeCalled = true;
        }
        return Promise.resolve(mockMetaDB);
      } else if (name === "test-db") {
        if (options?.upgrade && !mainUpgradeCalled) {
          options.upgrade(mockDB);
          mainUpgradeCalled = true;
        }
        return Promise.resolve(mockDB);
      }
      return Promise.resolve(mockDB);
    });

    await storage.init(mockSchema, "test-db");

    expect(mockDB.createObjectStore).toHaveBeenCalledWith("users");
    expect(mockDB.createObjectStore).toHaveBeenCalledWith("posts");
    expect(mockDB.createObjectStore).toHaveBeenCalledWith("__meta");
  });

  test("should delete and recreate object stores when hash changes", async () => {
    const { openDB } = await import("idb");
    const mockOpenDB = openDB as any;

    mockIndexedDB.databases.mockResolvedValue([]);

    // Setup meta DB mock
    mockMetaDB.objectStoreNames.contains.mockReturnValue(true);
    mockMetaDB.getAllRecords.mockResolvedValue({
      "test-db": {
        schemaHash: "old-hash",
        objectHashes: { users: "old-user-hash", posts: "old-post-hash" },
      },
    });

    // Setup main DB mock
    let storeExists = false;
    mockDB.objectStoreNames.contains.mockImplementation(() => {
      storeExists = !storeExists;
      return storeExists;
    });

    let metaUpgradeCalled = false;
    let mainUpgradeCalled = false;

    mockOpenDB.mockImplementation((name: any, version: any, options: any) => {
      if (name === "live-state-databases") {
        if (options?.upgrade && !metaUpgradeCalled) {
          options.upgrade(mockMetaDB);
          metaUpgradeCalled = true;
        }
        return Promise.resolve(mockMetaDB);
      } else if (name === "test-db") {
        if (options?.upgrade && !mainUpgradeCalled) {
          options.upgrade(mockDB);
          mainUpgradeCalled = true;
        }
        return Promise.resolve(mockDB);
      }
      return Promise.resolve(mockDB);
    });

    await storage.init(mockSchema, "test-db");

    expect(mockDB.deleteObjectStore).toHaveBeenCalledWith("users");
    expect(mockDB.createObjectStore).toHaveBeenCalledWith("users");

    expect(mockDB.deleteObjectStore).toHaveBeenCalledWith("posts");
    expect(mockDB.createObjectStore).toHaveBeenCalledWith("posts");
  });

  test("should get all data for resource type", async () => {
    const mockData = { user1: { name: "John" }, user2: { name: "Jane" } };

    // Mock the private getAll method behavior
    (mockDB as any).getAllRecords = undefined;
    mockDB.getAll.mockResolvedValue([{ name: "John" }, { name: "Jane" }]);
    mockDB.getAllKeys.mockResolvedValue(["user1", "user2"]);

    // Initialize storage with a mock db
    (storage as any).db = mockDB;

    const result = await storage.get("users");

    expect(result).toEqual(mockData);
  });

  test("should return empty object when no data exists", async () => {
    (storage as any).db = undefined;

    const result = await storage.get("users");

    expect(result).toEqual({});
  });

  test("should get one item by id", async () => {
    const mockPayload = { name: "John" };
    mockDB.get.mockResolvedValue(mockPayload);

    (storage as any).db = mockDB;

    const result = await storage.getOne("users", "user1");

    expect(result).toEqual(mockPayload);
    expect(mockDB.get).toHaveBeenCalledWith("users", "user1");
  });

  test("should return undefined when getting non-existent item", async () => {
    (storage as any).db = undefined;

    const result = await storage.getOne("users", "user1");

    expect(result).toBeUndefined();
  });

  test("should set item in storage", async () => {
    const mockPayload = {
      name: { value: "John" },
    } as DefaultMutationMessage["payload"];
    mockDB.put.mockResolvedValue(undefined);

    (storage as any).db = mockDB;

    await storage.set("users", "user1", mockPayload);

    expect(mockDB.put).toHaveBeenCalledWith("users", mockPayload, "user1");
  });

  test("should handle set when db is undefined", async () => {
    (storage as any).db = undefined;

    const result = await storage.set("users", "user1", { name: "John" } as any);

    expect(result).toBeUndefined();
  });

  test("should delete item from storage", async () => {
    mockDB.delete.mockResolvedValue(undefined);

    (storage as any).db = mockDB;

    await storage.delete("users", "user1");

    expect(mockDB.delete).toHaveBeenCalledWith("users", "user1");
  });

  test("should handle delete when db is undefined", async () => {
    (storage as any).db = undefined;

    const result = await storage.delete("users", "user1");

    expect(result).toBeUndefined();
  });

  test("should get meta data", async () => {
    const mockMetaData = { lastSync: "2023-01-01" };
    mockDB.get.mockResolvedValue(mockMetaData);

    (storage as any).db = mockDB;

    const result = await storage.getMeta("lastSync");

    expect(result).toEqual(mockMetaData);
    expect(mockDB.get).toHaveBeenCalledWith("__meta", "lastSync");
  });

  test("should return undefined when getting meta with no db", async () => {
    (storage as any).db = undefined;

    const result = await storage.getMeta("lastSync");

    expect(result).toBeUndefined();
  });

  test("should set meta data", async () => {
    const mockMetaData = { lastSync: "2023-01-01" };
    mockDB.put.mockResolvedValue(undefined);

    (storage as any).db = mockDB;

    await storage.setMeta("lastSync", mockMetaData);

    expect(mockDB.put).toHaveBeenCalledWith("__meta", mockMetaData, "lastSync");
  });

  test("should handle setMeta when db is undefined", async () => {
    (storage as any).db = undefined;

    const result = await storage.setMeta("lastSync", { value: "test" });

    expect(result).toBeUndefined();
  });

  test("should use getAllRecords when available", async () => {
    const mockData = { user1: { name: "John" }, user2: { name: "Jane" } };
    mockDB.getAllRecords = vi.fn().mockResolvedValue(mockData);

    (storage as any).db = mockDB;

    const result = await storage.get("users");

    expect(mockDB.getAllRecords).toHaveBeenCalledWith("users");
    expect(result).toEqual(mockData);
  });

  test("should handle getAll with undefined db", async () => {
    const result = await (storage as any).getAll(undefined, "users");

    expect(result).toBeUndefined();
  });

  test("should handle empty database results", async () => {
    mockDB.getAll.mockResolvedValue([]);
    mockDB.getAllKeys.mockResolvedValue([]);

    (storage as any).db = mockDB;

    const result = await storage.get("users");

    expect(result).toEqual({});
  });

  test("should properly map keys to values", async () => {
    const values = [{ name: "John" }, { name: "Jane" }, { name: "Bob" }];
    const keys = ["user1", "user2", "user3"];

    (mockDB as any).getAllRecords = undefined;
    mockDB.getAll.mockResolvedValue(values);
    mockDB.getAllKeys.mockResolvedValue(keys);

    (storage as any).db = mockDB;

    const result = await storage.get("users");

    expect(result).toEqual({
      user1: { name: "John" },
      user2: { name: "Jane" },
      user3: { name: "Bob" },
    });
  });
});
