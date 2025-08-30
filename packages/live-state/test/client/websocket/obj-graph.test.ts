import { describe, expect, test, vi } from "vitest";
import { ObjectGraph } from "../../../src/client/websocket/obj-graph";

describe("ObjectGraph", () => {
  test("should create an ObjectGraph instance", () => {
    const graph = new ObjectGraph();
    expect(graph).toBeInstanceOf(ObjectGraph);
  });

  test("should create a node with correct properties", () => {
    const graph = new ObjectGraph();
    const manyRelations = ["posts", "comments"];

    const node = graph.createNode("user1", "user", manyRelations);

    expect(node.id).toBe("user1");
    expect(node.type).toBe("user");
    expect(node.references).toBeInstanceOf(Map);
    expect(node.referencedBy).toBeInstanceOf(Map);
    expect(node.subscriptions).toBeInstanceOf(Set);
    expect(node.referencedBy.has("posts")).toBe(true);
    expect(node.referencedBy.has("comments")).toBe(true);
    expect(node.referencedBy.get("posts")).toBeInstanceOf(Set);
    expect(node.referencedBy.get("comments")).toBeInstanceOf(Set);
  });

  test("should throw error when creating node with existing id", () => {
    const graph = new ObjectGraph();

    graph.createNode("user1", "user", []);

    expect(() => {
      graph.createNode("user1", "user", []);
    }).toThrow("Node with id user1 already exists");
  });

  test("should get node by id", () => {
    const graph = new ObjectGraph();
    const node = graph.createNode("user1", "user", []);

    const retrievedNode = graph.getNode("user1");

    expect(retrievedNode).toBe(node);
  });

  test("should return undefined for non-existent node", () => {
    const graph = new ObjectGraph();

    const retrievedNode = graph.getNode("nonexistent");

    expect(retrievedNode).toBeUndefined();
  });

  test("should check if node exists", () => {
    const graph = new ObjectGraph();
    graph.createNode("user1", "user", []);

    expect(graph.hasNode("user1")).toBe(true);
    expect(graph.hasNode("nonexistent")).toBe(false);
  });

  test("should create link between nodes with one-to-one relation", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", []);
    const profileNode = graph.createNode("profile1", "profile", []);

    graph.createLink("user1", "profile1", "user");

    expect(userNode.references.get("user")).toBe("profile1");
    expect(profileNode.referencedBy.get("user")).toBe("user1");
  });

  test("should create link between nodes with one-to-many relation", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", ["posts"]);
    const postNode = graph.createNode("post1", "post", []);

    graph.createLink("post1", "user1", "posts");

    expect(postNode.references.get("posts")).toBe("user1");
    const backLink = userNode.referencedBy.get("posts") as Set<string>;
    expect(backLink).toBeInstanceOf(Set);
    expect(backLink.has("post1")).toBe(true);
  });

  test("should notify subscribers when creating link", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", []);
    const profileNode = graph.createNode("profile1", "profile", []);

    const mockSubscriber = vi.fn();
    graph.subscribe("profile1", mockSubscriber);

    graph.createLink("user1", "profile1", "user");

    expect(mockSubscriber).toHaveBeenCalledWith("profile1");
  });

  test("should throw error when creating link with non-existent source node", () => {
    const graph = new ObjectGraph();
    graph.createNode("profile1", "profile", []);

    expect(() => {
      graph.createLink("nonexistent", "profile1", "user");
    }).toThrow("Source node with id nonexistent does not exist");
  });

  test("should throw error when creating link with non-existent target node", () => {
    const graph = new ObjectGraph();
    graph.createNode("user1", "user", []);

    expect(() => {
      graph.createLink("user1", "nonexistent", "user");
    }).toThrow("Target node with id nonexistent does not exist");
  });

  test("should remove link between nodes", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", []);
    const profileNode = graph.createNode("profile1", "profile", []);

    graph.createLink("user1", "profile1", "user");
    graph.removeLink("user1", "user");

    expect(userNode.references.has("user")).toBe(false);
    expect(profileNode.referencedBy.has("user")).toBe(false);
  });

  test("should remove link from many relation", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", ["posts"]);
    const postNode = graph.createNode("post1", "post", []);

    graph.createLink("post1", "user1", "posts");
    graph.removeLink("post1", "posts");

    expect(postNode.references.has("posts")).toBe(false);
    const backLink = userNode.referencedBy.get("posts") as Set<string>;
    expect(backLink.has("post1")).toBe(false);
  });

  test("should notify subscribers when removing link", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", []);
    const profileNode = graph.createNode("profile1", "profile", []);

    graph.createLink("user1", "profile1", "user");

    const mockSubscriber = vi.fn();
    graph.subscribe("profile1", mockSubscriber);
    graph.subscribe("user1", mockSubscriber);

    graph.removeLink("user1", "user");

    expect(mockSubscriber).toHaveBeenCalledWith("profile1");
    expect(mockSubscriber).toHaveBeenCalledWith("user1");
  });

  test("should handle removing non-existent link gracefully", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", []);

    expect(() => {
      graph.removeLink("user1", "nonexistent");
    }).not.toThrow();
  });

  test("should throw error when removing link from non-existent node", () => {
    const graph = new ObjectGraph();

    expect(() => {
      graph.removeLink("nonexistent", "user");
    }).toThrow("Node with id nonexistent does not exist");
  });

  test("should subscribe to node changes", () => {
    const graph = new ObjectGraph();
    graph.createNode("user1", "user", []);

    const mockSubscriber = vi.fn();
    const unsubscribe = graph.subscribe("user1", mockSubscriber);

    expect(typeof unsubscribe).toBe("function");
  });

  test("should throw error when subscribing to non-existent node", () => {
    const graph = new ObjectGraph();

    expect(() => {
      graph.subscribe("nonexistent", vi.fn());
    }).toThrow("Node with id nonexistent does not exist");
  });

  test("should unsubscribe from node changes", () => {
    const graph = new ObjectGraph();
    const node = graph.createNode("user1", "user", []);

    const mockSubscriber = vi.fn();
    const unsubscribe = graph.subscribe("user1", mockSubscriber);

    expect(node.subscriptions.has(mockSubscriber)).toBe(true);

    unsubscribe();

    expect(node.subscriptions.has(mockSubscriber)).toBe(false);
  });

  // TODO fix and uncomment
  test.skip("should remove node and all its links", () => {
    const graph = new ObjectGraph();
    const userNode = graph.createNode("user1", "user", ["posts"]);
    const profileNode = graph.createNode("profile1", "profile", ["user"]);
    const postNode = graph.createNode("post1", "post", []);

    graph.createLink("user1", "profile1", "user");
    graph.createLink("post1", "user1", "posts");

    const mockSubscriber = vi.fn();
    graph.subscribe("post1", mockSubscriber);

    graph.removeNode("user1");

    expect(graph.hasNode("user1")).toBe(false);
    expect(profileNode.referencedBy.has("user")).toBe(false);
    expect(postNode.references.get("posts")).toBe(undefined);
    expect(mockSubscriber).toHaveBeenCalledWith("post1");
  });

  test("should handle removing non-existent node gracefully", () => {
    const graph = new ObjectGraph();

    expect(() => {
      graph.removeNode("nonexistent");
    }).not.toThrow();
  });

  test("should update node and notify subscribers", () => {
    const graph = new ObjectGraph();
    const node = graph.createNode("user1", "user", []);

    const mockSubscriber = vi.fn();
    graph.subscribe("user1", mockSubscriber);

    graph.updateNode("user1", (node) => {
      node.type = "updated_user";
    });

    expect(node.type).toBe("updated_user");
    expect(mockSubscriber).toHaveBeenCalledWith("user1");
  });

  test("should throw error when updating non-existent node", () => {
    const graph = new ObjectGraph();

    expect(() => {
      graph.updateNode("nonexistent", vi.fn());
    }).toThrow("Node with id nonexistent does not exist");
  });

  test("should notify subscribers and handle errors gracefully", () => {
    const graph = new ObjectGraph();
    graph.createNode("user1", "user", []);

    const errorSubscriber = vi.fn().mockImplementation(() => {
      throw new Error("Subscriber error");
    });
    const normalSubscriber = vi.fn();

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    graph.subscribe("user1", errorSubscriber);
    graph.subscribe("user1", normalSubscriber);

    graph.notifySubscribers("user1");

    expect(errorSubscriber).toHaveBeenCalled();
    expect(normalSubscriber).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Error in node subscription for node user1:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  test("should handle notifying subscribers of non-existent node gracefully", () => {
    const graph = new ObjectGraph();

    expect(() => {
      graph.notifySubscribers("nonexistent");
    }).not.toThrow();
  });

  test("should get all nodes", () => {
    const graph = new ObjectGraph();
    const node1 = graph.createNode("user1", "user", []);
    const node2 = graph.createNode("user2", "user", []);
    const node3 = graph.createNode("post1", "post", []);

    const allNodes = graph.getAllNodes();

    expect(allNodes).toHaveLength(3);
    expect(allNodes).toContain(node1);
    expect(allNodes).toContain(node2);
    expect(allNodes).toContain(node3);
  });

  test("should return empty array when no nodes exist", () => {
    const graph = new ObjectGraph();

    const allNodes = graph.getAllNodes();

    expect(allNodes).toHaveLength(0);
    expect(Array.isArray(allNodes)).toBe(true);
  });

  test("should handle complex graph operations", () => {
    const graph = new ObjectGraph();

    // Create nodes
    const userNode = graph.createNode("user1", "user", ["posts", "comments"]);
    const postNode1 = graph.createNode("post1", "post", []);
    const postNode2 = graph.createNode("post2", "post", []);
    const commentNode = graph.createNode("comment1", "comment", []);

    // Create links
    graph.createLink("post1", "user1", "posts");
    graph.createLink("post2", "user1", "posts");
    graph.createLink("comment1", "user1", "comments");

    // Verify many relations
    const postsBackLink = userNode.referencedBy.get("posts") as Set<string>;
    const commentsBackLink = userNode.referencedBy.get(
      "comments"
    ) as Set<string>;

    expect(postsBackLink.has("post1")).toBe(true);
    expect(postsBackLink.has("post2")).toBe(true);
    expect(commentsBackLink.has("comment1")).toBe(true);

    // Remove one post
    graph.removeLink("post1", "posts");

    expect(postsBackLink.has("post1")).toBe(false);
    expect(postsBackLink.has("post2")).toBe(true);
    expect(postNode1.references.has("posts")).toBe(false);
  });
});
