import { describe, test, expect, beforeEach, vi } from "vitest";
import { IncrementalQueryEngine } from "../../../src/core/incremental-query-engine";
import { createSchema, object, id, string, number } from "../../../src/schema";
import type {
  RawQueryRequest,
  DefaultMutation,
} from "../../../src/core/schemas/core-protocol";
import * as schemaModule from "../../../src/schema";

// Create a test schema
const user = object("users", {
  id: id(),
  name: string(),
  email: string(),
  age: number(),
});

const post = object("posts", {
  id: id(),
  title: string(),
  content: string(),
});

const testSchema = createSchema({
  users: user,
  posts: post,
});

describe("IncrementalQueryEngine", () => {
  let engine: IncrementalQueryEngine;

  beforeEach(() => {
    engine = new IncrementalQueryEngine(testSchema);
  });

  describe("registerQuery", () => {
    test("should register a query with a subscription", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      const unsubscribe = engine.registerQuery(query, subscription);

      expect(unsubscribe).toBeInstanceOf(Function);
    });

    test("should return unsubscribe function that removes subscription", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      const unsubscribe1 = engine.registerQuery(query, subscription1);
      const unsubscribe2 = engine.registerQuery(query, subscription2);

      unsubscribe1();

      // Query should still exist because subscription2 is still active
      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.subscriptions.has(subscription1)).toBe(false);
      expect(queryNode?.subscriptions.has(subscription2)).toBe(true);
    });

    test("should remove query node when all subscriptions are removed", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      const unsubscribe = engine.registerQuery(query, subscription);

      expect(engine["queryNodes"].size).toBe(1);

      unsubscribe();

      expect(engine["queryNodes"].size).toBe(0);
    });

    test("should reuse same query node for identical queries", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query, subscription1);
      engine.registerQuery(query, subscription2);

      expect(engine["queryNodes"].size).toBe(1);

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.subscriptions.size).toBe(2);
      expect(queryNode?.subscriptions.has(subscription1)).toBe(true);
      expect(queryNode?.subscriptions.has(subscription2)).toBe(true);
    });

    test("should create different query nodes for different queries", () => {
      const query1: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const query2: RawQueryRequest = {
        resource: "users",
        where: { name: "Jane" },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query1, subscription1);
      engine.registerQuery(query2, subscription2);

      expect(engine["queryNodes"].size).toBe(2);
    });
  });

  describe("loadQueryResults", () => {
    test("should load results for a registered query", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const results = [
        { id: "user1", type: "users", name: "John", email: "john@example.com" },
        { id: "user2", type: "users", name: "Jane", email: "jane@example.com" },
      ];

      engine.loadQueryResults(query, results);

      expect(engine["objectNodes"].size).toBe(2);
      expect(engine["objectNodes"].has("user1")).toBe(true);
      expect(engine["objectNodes"].has("user2")).toBe(true);
    });

    test("should link object nodes to query nodes", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const results = [{ id: "user1", type: "users", name: "John" }];

      engine.loadQueryResults(query, results);

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      const objectNode = engine["objectNodes"].get("user1");

      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(true);
      expect(objectNode?.matchedQueries.has(queryHash)).toBe(true);
    });

    test("should throw error if query not found", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const results = [{ id: "user1", type: "users", name: "John" }];

      expect(() => {
        engine.loadQueryResults(query, results);
      }).toThrow("Query with hash");
    });

    test("should handle multiple results", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const results = [
        { id: "user1", type: "users", name: "John" },
        { id: "user2", type: "users", name: "Jane" },
        { id: "user3", type: "users", name: "Bob" },
      ];

      engine.loadQueryResults(query, results);

      expect(engine["objectNodes"].size).toBe(3);

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.matchingObjectNodes.size).toBe(3);
    });

    test("should update existing object node with new matched query", () => {
      const query1: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const query2: RawQueryRequest = {
        resource: "users",
        where: { email: "john@example.com" },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query1, subscription1);
      engine.registerQuery(query2, subscription2);

      // Load results for first query
      engine.loadQueryResults(query1, [
        { id: "user1", type: "users", name: "John", email: "john@example.com" },
      ]);

      // Load results for second query (same object)
      engine.loadQueryResults(query2, [
        { id: "user1", type: "users", name: "John", email: "john@example.com" },
      ]);

      const objectNode = engine["objectNodes"].get("user1");
      expect(objectNode?.matchedQueries.size).toBe(2);
    });
  });

  describe("handleMutation - INSERT", () => {
    test("should insert new object and match queries without where clause", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      expect(engine["objectNodes"].has("user1")).toBe(true);
      expect(subscription).toHaveBeenCalledTimes(1);

      const objectNode = engine["objectNodes"].get("user1");
      expect(objectNode?.id).toBe("user1");
      expect(objectNode?.type).toBe("MUTATE");
    });

    test("should match queries with where clause", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      expect(subscription).toHaveBeenCalledTimes(1);

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(true);
    });

    test("should not match queries when where clause does not match", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "Jane" },
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      expect(subscription).not.toHaveBeenCalled();

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(false);
    });

    test("should notify all subscribers when object matches multiple queries", () => {
      const query1: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const query2: RawQueryRequest = {
        resource: "users",
        where: { age: 30 },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query1, subscription1);
      engine.registerQuery(query2, subscription2);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      expect(subscription1).toHaveBeenCalledTimes(1);
      expect(subscription2).toHaveBeenCalledTimes(1);
    });

    test("should not match queries for different resources", () => {
      const query: RawQueryRequest = {
        resource: "posts",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      expect(subscription).not.toHaveBeenCalled();
    });

    test("should skip insertion if object already exists", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // First insert
      const mutation1: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation1);
      expect(subscription).toHaveBeenCalledTimes(1);

      // Second insert with same resourceId
      const mutation2: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(mutation2);
      // Subscription should not be called again
      expect(subscription).toHaveBeenCalledTimes(1);
    });

    test("should skip insertion if inferValue returns undefined", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // Mock inferValue to return undefined
      const inferValueSpy = vi
        .spyOn(schemaModule, "inferValue")
        .mockReturnValue(undefined);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      expect(subscription).not.toHaveBeenCalled();
      expect(engine["objectNodes"].has("user1")).toBe(false);

      inferValueSpy.mockRestore();
    });

    test("should link object node to all matched queries", () => {
      const query1: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const query2: RawQueryRequest = {
        resource: "users",
        where: { age: 30 },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query1, subscription1);
      engine.registerQuery(query2, subscription2);

      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(mutation);

      const objectNode = engine["objectNodes"].get("user1");
      expect(objectNode?.matchedQueries.size).toBe(2);
    });
  });

  describe("handleMutation - UPDATE", () => {
    test("should update existing object and notify matching queries", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // First insert the object
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription).toHaveBeenCalledTimes(1);

      // Now update the object
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "John" },
          email: { value: "john.updated@example.com" },
          age: { value: 31 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).toHaveBeenCalledTimes(2);
      expect(engine["objectNodes"].has("user1")).toBe(true);
    });

    test("should remove object from query when update causes it to no longer match", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // Insert object that matches
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription).toHaveBeenCalledTimes(1);

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(true);

      // Update object so it no longer matches
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).toHaveBeenCalledTimes(2);
      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(false);

      const objectNode = engine["objectNodes"].get("user1");
      expect(objectNode?.matchedQueries.has(queryHash)).toBe(false);
    });

    test("should add object to query when update causes it to match", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // Insert object that doesn't match
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription).not.toHaveBeenCalled();

      const queryHash = engine["queryNodes"].keys().next().value!;
      const queryNode = engine["queryNodes"].get(queryHash);
      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(false);

      // Update object so it now matches
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).toHaveBeenCalledTimes(1);
      expect(queryNode?.matchingObjectNodes.has("user1")).toBe(true);

      const objectNode = engine["objectNodes"].get("user1");
      expect(objectNode?.matchedQueries.has(queryHash)).toBe(true);
    });

    test("should notify subscribers when object still matches after update", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // Insert object that matches
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription).toHaveBeenCalledTimes(1);

      // Update object but it still matches
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "John" },
          email: { value: "john.updated@example.com" },
          age: { value: 31 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).toHaveBeenCalledTimes(2);
    });

    test("should skip update if object does not exist", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      const updateMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).not.toHaveBeenCalled();
      expect(engine["objectNodes"].has("user1")).toBe(false);
    });

    test("should skip update if inferValue returns undefined", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // First insert the object
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription).toHaveBeenCalledTimes(1);

      // Mock inferValue to return undefined for update
      const inferValueSpy = vi
        .spyOn(schemaModule, "inferValue")
        .mockReturnValue(undefined);

      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).toHaveBeenCalledTimes(1); // Still only called once from insert
      expect(engine["objectNodes"].has("user1")).toBe(true);

      inferValueSpy.mockRestore();
    });

    test("should notify all subscribers when object matches multiple queries", () => {
      const query1: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const query2: RawQueryRequest = {
        resource: "users",
        where: { age: 30 },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query1, subscription1);
      engine.registerQuery(query2, subscription2);

      // Insert object that matches both queries
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription1).toHaveBeenCalledTimes(1);
      expect(subscription2).toHaveBeenCalledTimes(1);

      // Update object (still matches both)
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "John" },
          email: { value: "john.updated@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription1).toHaveBeenCalledTimes(2);
      expect(subscription2).toHaveBeenCalledTimes(2);
    });

    test("should not match queries for different resources", () => {
      const query: RawQueryRequest = {
        resource: "posts",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // Insert a user object
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);

      // Update the user object
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).not.toHaveBeenCalled();
    });

    test("should handle update that causes object to match new queries and unmatch old ones", () => {
      const query1: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const query2: RawQueryRequest = {
        resource: "users",
        where: { name: "Jane" },
      };
      const subscription1 = vi.fn();
      const subscription2 = vi.fn();

      engine.registerQuery(query1, subscription1);
      engine.registerQuery(query2, subscription2);

      // Insert object that matches query1
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription1).toHaveBeenCalledTimes(1);
      expect(subscription2).not.toHaveBeenCalled();

      const queryHash1 = Array.from(engine["queryNodes"].keys())[0];
      const queryHash2 = Array.from(engine["queryNodes"].keys())[1];
      const queryNode1 = engine["queryNodes"].get(queryHash1);
      const queryNode2 = engine["queryNodes"].get(queryHash2);

      expect(queryNode1?.matchingObjectNodes.has("user1")).toBe(true);
      expect(queryNode2?.matchingObjectNodes.has("user1")).toBe(false);

      // Update object so it matches query2 instead of query1
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription1).toHaveBeenCalledTimes(2);
      expect(subscription2).toHaveBeenCalledTimes(1);

      expect(queryNode1?.matchingObjectNodes.has("user1")).toBe(false);
      expect(queryNode2?.matchingObjectNodes.has("user1")).toBe(true);

      const objectNode = engine["objectNodes"].get("user1");
      expect(objectNode?.matchedQueries.has(queryHash1)).toBe(false);
      expect(objectNode?.matchedQueries.has(queryHash2)).toBe(true);
    });

    test("should handle update with queries without where clause", () => {
      const query: RawQueryRequest = {
        resource: "users",
      };
      const subscription = vi.fn();

      engine.registerQuery(query, subscription);

      // Insert object
      const insertMutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john@example.com" },
          age: { value: 30 },
        },
      };

      engine.handleMutation(insertMutation);
      expect(subscription).toHaveBeenCalledTimes(1);

      // Update object
      const updateMutation: DefaultMutation = {
        id: "mutation2",
        type: "MUTATE",
        resource: "users",
        resourceId: "user1",
        procedure: "UPDATE",
        payload: {
          name: { value: "Jane" },
          email: { value: "jane@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(updateMutation);

      expect(subscription).toHaveBeenCalledTimes(2);
    });
  });

  describe("integration", () => {
    test("should handle full flow: register query, load results, handle mutation", () => {
      const query: RawQueryRequest = {
        resource: "users",
        where: { name: "John" },
      };
      const subscription = vi.fn();

      // Register query
      engine.registerQuery(query, subscription);

      // Load initial results
      engine.loadQueryResults(query, [
        { id: "user1", type: "users", name: "John", email: "john@example.com" },
      ]);

      expect(engine["objectNodes"].size).toBe(1);
      expect(subscription).not.toHaveBeenCalled(); // Should not notify on load

      // Handle new mutation
      const mutation: DefaultMutation = {
        id: "mutation1",
        type: "MUTATE",
        resource: "users",
        resourceId: "user2",
        procedure: "INSERT",
        payload: {
          name: { value: "John" },
          email: { value: "john2@example.com" },
          age: { value: 25 },
        },
      };

      engine.handleMutation(mutation);

      expect(engine["objectNodes"].size).toBe(2);
      expect(subscription).toHaveBeenCalledTimes(1);
    });
  });
});
