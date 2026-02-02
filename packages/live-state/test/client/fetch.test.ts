import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { createClient } from "../../src/client/fetch";
import { createSchema, object, id, string, reference } from "../../src/schema";
import { router as createRouter, routeFactory } from "../../src/server/router";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock consumeGeneratable
vi.mock("../../src/core/utils", () => ({
  consumeGeneratable: vi.fn(),
}));

import { consumeGeneratable } from "../../src/core/utils";

describe("createClient", () => {
  let mockSchema: any;
  let mockRouter: any;
  let mockConsumeGeneratable: any;

  beforeEach(() => {
    // Create a simple schema for testing
    const user = object("users", {
      id: id(),
      name: string(),
    });

    const post = object("posts", {
      id: id(),
      title: string(),
      authorId: reference("users.id"),
    });

    mockSchema = createSchema({
      user,
      post,
    });

    const publicRoute = routeFactory();
    mockRouter = createRouter({
      schema: mockSchema,
      routes: {
        users: publicRoute.collectionRoute(mockSchema.users),
        posts: publicRoute.collectionRoute(mockSchema.posts),
      },
    });

    mockConsumeGeneratable = vi.mocked(consumeGeneratable);
    mockConsumeGeneratable.mockImplementation((fn: any) => fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  test("should create client with query and mutate methods", () => {
    const client = createClient({
      url: "http://localhost:3000",
      schema: mockSchema,
      credentials: async () => ({}),
    });

    expect(client).toHaveProperty("query");
    expect(client).toHaveProperty("mutate");
    expect(client.query).toHaveProperty("users");
    expect(client.query).toHaveProperty("posts");
    expect(client.mutate).toHaveProperty("users");
    expect(client.mutate).toHaveProperty("posts");
  });

  test("should create query builders for each route", () => {
    const client = createClient({
      url: "http://localhost:3000",
      schema: mockSchema,
      credentials: async () => ({}),
    });

    expect(typeof client.query.users.get).toBe("function");
    expect(typeof client.query.users.subscribe).toBe("function");
    expect(typeof client.query.posts.get).toBe("function");
    expect(typeof client.query.posts.subscribe).toBe("function");
  });

  test("should create mutate methods for each route", () => {
    const client = createClient({
      url: "http://localhost:3000",
      schema: mockSchema,
      credentials: async () => ({}),
    });

    expect(typeof client.mutate.users.insert).toBe("function");
    expect(typeof client.mutate.users.update).toBe("function");
    expect(typeof client.mutate.posts.insert).toBe("function");
    expect(typeof client.mutate.posts.update).toBe("function");
  });

  describe("query.get", () => {
    test("should make GET request with correct URL and headers", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({ Authorization: "Bearer token" }),
      });

      const result = await client.query.users.get();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users?resource=users",
        {
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
        }
      );
      expect(result).toEqual([{ id: "1", name: "John" }]);
    });

    test("should handle query parameters", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.where({ name: "John" }).get();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users?resource=users&where%5Bname%5D=John",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    });

    test("should handle complex query parameters", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users
        .where({ name: "John", age: 30 })
        .include({ posts: true })
        .limit(10)
        .get();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3000/users?"),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5Bname%5D=John");
      expect(url).toContain("where%5Bage%5D=30");
    });

    test("should handle empty query parameters", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.get();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users?resource=users",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    });

    test("should handle credentials that return null", async () => {
      mockConsumeGeneratable.mockImplementationOnce(() => null);
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.get();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users?resource=users",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    });

    test("should handle different base URLs", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "https://api.example.com/v1",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.get();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/v1/users?resource=users",
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    });
  });

  describe("query.subscribe", () => {
    test("should throw error for subscriptions", () => {
      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      expect(() => {
        client.query.users.subscribe(() => {});
      }).toThrow("Fetch client does not support subscriptions");
    });
  });

  describe("mutate.insert", () => {
    test("should make POST request for insert with correct payload", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({ Authorization: "Bearer token" }),
      });

      const userData = { id: "1", name: "John" };
      await client.mutate.users.insert(userData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/insert",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"resourceId":"1"'),
        }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toHaveProperty("resourceId", "1");
      expect(body).toHaveProperty("payload");
    });

    test("should handle insert without credentials", async () => {
      mockConsumeGeneratable.mockResolvedValueOnce(null);
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const userData = { id: "1", name: "John" };
      await client.mutate.users.insert(userData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/insert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.any(String),
        }
      );
    });

    test("should handle different routes for insert", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const postData = { id: "1", title: "Test Post", authorId: "user1" };
      await client.mutate.posts.insert(postData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/posts/insert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"resourceId":"1"'),
        }
      );
    });
  });

  describe("mutate.update", () => {
    test("should make POST request for update with correct payload", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({ Authorization: "Bearer token" }),
      });

      const updateData = { name: "John Updated" };
      await client.mutate.users.update("1", updateData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/update",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"resourceId":"1"'),
        }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toHaveProperty("resourceId", "1");
      expect(body).toHaveProperty("payload");
    });

    test("should exclude id from update payload", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const updateData = { id: "1", name: "John Updated" };
      await client.mutate.users.update("1", updateData);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload).not.toHaveProperty("id");
    });

    test("should handle different routes for update", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const updateData = { title: "Updated Post" };
      await client.mutate.posts.update("1", updateData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/posts/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"resourceId":"1"'),
        }
      );
    });
  });

  describe("mutate custom methods", () => {
    test("should make POST request for custom methods", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({ Authorization: "Bearer token" }),
      });

      // Test custom method (this would need to be defined in the route)
      const customData = { someData: "test" };

      // Since we don't have custom methods in our test schema,
      // we'll test the path length validation by calling a method with too many path segments
      await expect(async () => {
        await (client.mutate as any).users.customMethod.subMethod(customData);
      }).rejects.toThrow("Trying to access an invalid path");
    });

    test("should handle path length validation", async () => {
      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const customData = { someData: "test" };

      // Test path too short - calling users directly should not throw
      expect(() => {
        (client.mutate as any).users();
      }).not.toThrow();

      // Test path too long - this should throw
      await expect(async () => {
        await (client.mutate as any).users.method.submethod(customData);
      }).rejects.toThrow("Trying to access an invalid path");
    });

    test("should return value from custom mutation", async () => {
      const customMutationResponse = {
        message: "Hello World",
        userId: "user-123",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(customMutationResponse),
      });

      // Create a schema with a route that has custom mutations
      const user = object("users", {
        id: id(),
        name: string(),
      });

      const schemaWithCustomMutations = createSchema({
        user,
      });

      const publicRoute = routeFactory();
      const routerWithCustomMutations = createRouter({
        schema: schemaWithCustomMutations,
        routes: {
          users: publicRoute
            .collectionRoute(schemaWithCustomMutations.users)
            .withMutations(({ mutation }) => ({
              hello: mutation(z.string()).handler(async ({ req }) => {
                return {
                  message: `Hello ${req.input}`,
                  userId: "user-123",
                };
              }),
            })),
        },
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: schemaWithCustomMutations,
        credentials: async () => ({}),
      });

      const result = await (client.mutate as any).users.hello("World");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/hello",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload).toBe("World");
      expect(body.meta).toHaveProperty("timestamp");

      expect(result).toEqual(customMutationResponse);
    });
  });

  describe("error handling", () => {
    test("should handle fetch errors", async () => {
      const error = new Error("Network error");
      mockFetch.mockRejectedValueOnce(error);

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await expect(client.query.users.get()).rejects.toThrow("Network error");
    });

    test("should handle JSON parsing errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.reject(new Error("Invalid JSON")),
        text: () => Promise.resolve("Invalid JSON response"),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const result = await client.query.users.get();
      // When JSON parsing fails, the client falls back to res.text() which returns a string.
      // Object.entries() on a string returns an empty array since strings don't have enumerable properties.
      expect(result).toEqual([]);
    });

    test("should handle credentials function errors", async () => {
      mockConsumeGeneratable.mockImplementationOnce(() => {
        throw new Error("Credentials error");
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => {
          throw new Error("Credentials error");
        },
      });

      await expect(client.query.users.get()).rejects.toThrow(
        "Credentials error"
      );
    });
  });

  describe("URL construction", () => {
    test("should handle URLs with trailing slash", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000/",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.get();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000//users?resource=users",
        expect.any(Object)
      );
    });

    test("should handle URLs without trailing slash", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.get();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users?resource=users",
        expect.any(Object)
      );
    });
  });

  describe("mutation payload encoding", () => {
    test("should encode mutation with timestamp", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const userData = { id: "1", name: "John" };
      await client.mutate.users.insert(userData);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.name).toHaveProperty("_meta");
      expect(body.payload.name._meta).toHaveProperty("timestamp");
    });

    test("should handle different mutation types", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      const updateData = { name: "John Updated" };
      await client.mutate.users.update("1", updateData);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.name).toHaveProperty("_meta");
      expect(body.payload.name._meta).toHaveProperty("timestamp");
    });
  });

  describe("null where clause serialization", () => {
    test("should serialize implicit null equality in where clause", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.where({ name: null } as any).get();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5Bname%5D=null");
    });

    test("should serialize explicit null equality with $eq operator", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.where({ name: { $eq: null } } as any).get();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5Bname%5D%5B%24eq%5D=null");
    });

    test("should serialize null with $not operator", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.where({ name: { $not: null } } as any).get();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5Bname%5D%5B%24not%5D=null");
    });

    test("should serialize null in nested where clauses", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users
        .where({
          $and: [{ name: null }, { name: { $eq: null } }],
        } as any)
        .get();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5B%24and%5D%5B0%5D%5Bname%5D=null");
      expect(url).toContain(
        "where%5B%24and%5D%5B1%5D%5Bname%5D%5B%24eq%5D=null"
      );
    });

    test("should serialize null in $in array", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users
        .where({ name: { $in: [null, "John"] } } as any)
        .get();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5Bname%5D%5B%24in%5D%5B0%5D=null");
      expect(url).toContain("where%5Bname%5D%5B%24in%5D%5B1%5D=John");
    });

    test("should serialize multiple null fields in where clause", async () => {
      const mockResponse = {
        "1": {
          value: {
            name: {
              value: "John",
              _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
            },
          },
          _meta: { timestamp: "2023-01-01T00:00:00.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockResponse),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users
        .where({
          name: null,
          id: { $eq: null },
        } as any)
        .get();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("where%5Bname%5D=null");
      expect(url).toContain("where%5Bid%5D%5B%24eq%5D=null");
    });
  });
});
