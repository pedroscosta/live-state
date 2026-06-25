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
        users: publicRoute.withProcedures(() => ({})),
        posts: publicRoute.withProcedures(() => ({})),
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

  test("should expose callable custom query procedures for each route", () => {
    const client = createClient({
      url: "http://localhost:3000",
      schema: mockSchema,
      credentials: async () => ({}),
    });

    // Fetch client is custom-query-only: any declared procedure name resolves
    // to a callable that POSTs to `/<resource>/query/<procedure>` (ADR-0002).
    expect(typeof client.query.users.list).toBe("function");
    expect(typeof client.query.posts.list).toBe("function");
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

  // The fetch client is Custom Query-only (ADR-0002): reads go through
  // POST `/<resource>/query/<procedure>` with a JSON `{ input }` body. The
  // Default Query GET path (`query.users.where(...).get()`) was removed.
  describe("query custom procedures", () => {
    test("should make POST request with correct URL, headers, and body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve([{ id: "1", name: "John" }]),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({ Authorization: "Bearer token" }),
      });

      const result = await client.query.users.list({ status: "active" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/query/list",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: { status: "active" } }),
        }
      );
      expect(result).toEqual([{ id: "1", name: "John" }]);
    });

    test("should call a custom query with no input", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve([]),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/query/list",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: undefined }),
        }
      );
    });

    test("should handle credentials that return null", async () => {
      mockConsumeGeneratable.mockImplementationOnce(() => null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve([]),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/query/list",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: undefined }),
        }
      );
    });

    test("should handle different base URLs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve([]),
      });

      const client = createClient({
        url: "https://api.example.com/v1",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/v1/users/query/list",
        expect.objectContaining({ method: "POST" })
      );
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
          body: expect.stringContaining('"payload":{"id":"1","name":"John"}'),
        }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual(
        expect.objectContaining({
          payload: { id: "1", name: "John" },
          meta: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        })
      );
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
          body: expect.stringContaining(
            '"payload":{"id":"1","title":"Test Post","authorId":"user1"}'
          ),
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

      const updateData = { id: "1", name: "John Updated" };
      await client.mutate.users.update(updateData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/update",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"payload":{"id":"1","name":"John Updated"}'),
        }
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual(
        expect.objectContaining({
          payload: { id: "1", name: "John Updated" },
          meta: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        })
      );
    });

    test("should forward the full update payload including id", async () => {
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
      await client.mutate.users.update(updateData);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload).toHaveProperty("id", "1");
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

      const updateData = { id: "1", title: "Updated Post" };
      await client.mutate.posts.update(updateData);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/posts/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"payload":{"id":"1","title":"Updated Post"}'),
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

      await expect(client.query.users.list()).rejects.toThrow("Network error");
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

      // When JSON parsing fails, the client falls back to res.text(); the custom
      // query returns that raw value as-is.
      const result = await client.query.users.list();
      expect(result).toBe("Invalid JSON response");
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

      await expect(client.query.users.list()).rejects.toThrow(
        "Credentials error"
      );
    });
  });

  describe("URL construction", () => {
    test("should handle URLs with trailing slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve([]),
      });

      const client = createClient({
        url: "http://localhost:3000/",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/query/list",
        expect.any(Object)
      );
    });

    test("should handle URLs without trailing slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve([]),
      });

      const client = createClient({
        url: "http://localhost:3000",
        schema: mockSchema,
        credentials: async () => ({}),
      });

      await client.query.users.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/users/query/list",
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
      expect(body.payload.name).toBe("John");
      expect(body.meta).toHaveProperty("timestamp");
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

      const updateData = { id: "1", name: "John Updated" };
      await client.mutate.users.update(updateData);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.name).toBe("John Updated");
      expect(body.meta).toHaveProperty("timestamp");
    });
  });
});
