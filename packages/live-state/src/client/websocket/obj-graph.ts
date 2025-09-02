/**
 * Graph data structure implementation
 * Represents a directed graph with nodes that can reference each other
 */

// Define types for node subscriptions
type NodeSubscription = (nodeId: string) => void;

// Define the node structure
export type GraphNode = {
  id: string;
  type: string;
  references: Map<string, string>;
  referencedBy: Map<string, Set<string> | string>;
  subscriptions: Set<NodeSubscription>;
};

/**
 * ObjectGraph class implements a directed graph where nodes can reference each other
 * with O(1) lookup complexity by node ID
 */
export class ObjectGraph {
  private nodes: Map<string, GraphNode>;

  constructor() {
    this.nodes = new Map<string, GraphNode>();
  }

  /**
   * Creates a new node in the graph
   * @param id The unique identifier for the node
   * @param type The type of the node
   * @returns The created node
   */
  createNode(id: string, type: string, manyRelations: string[]): GraphNode {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id ${id} already exists`);
    }

    const node: GraphNode = {
      id,
      type,
      referencedBy: new Map<string, Set<string> | string>(
        manyRelations.map((r) => [r, new Set<string>()])
      ),
      references: new Map<string, string>(),
      subscriptions: new Set<NodeSubscription>(),
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * Gets a node from the graph by its ID
   * @param id The ID of the node to retrieve
   * @returns The node or undefined if not found
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Checks if a node exists in the graph
   * @param id The ID of the node to check
   * @returns True if the node exists, false otherwise
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Creates a link between two nodes
   * @param sourceNodeId The ID of the source node
   * @param targetNodeId The ID of the target node
   */
  createLink(sourceNodeId: string, targetNodeId: string): void {
    const sourceNode = this.nodes.get(sourceNodeId);
    const targetNode = this.nodes.get(targetNodeId);

    if (!sourceNode) {
      throw new Error(`Source node with id ${sourceNodeId} does not exist`);
    }

    if (!targetNode) {
      throw new Error(`Target node with id ${targetNodeId} does not exist`);
    }

    // Add the reference from source to target
    sourceNode.references.set(targetNode.type, targetNodeId);

    // Add the backlink from target to source
    const backLink = targetNode.referencedBy.get(sourceNode.type);

    if (backLink && backLink instanceof Set) {
      backLink.add(sourceNodeId);
    } else {
      targetNode.referencedBy.set(sourceNode.type, sourceNodeId);
    }

    this.notifySubscribers(targetNodeId);
  }

  /**
   * Removes a link between two nodes
   * @param sourceNodeId The ID of the source node
   * @param targetNodeType The type of the target node
   */
  removeLink(sourceNodeId: string, targetNodeType: string): void {
    const sourceNode = this.nodes.get(sourceNodeId);
    if (!sourceNode) {
      throw new Error(`Node with id ${sourceNodeId} does not exist`);
    }

    const reference = sourceNode.references.get(targetNodeType);

    if (!reference) return;

    sourceNode.references.delete(targetNodeType);

    const node = this.nodes.get(reference);

    if (!node) return;

    const backLink = node.referencedBy.get(sourceNode.type);

    if (backLink) {
      if (backLink instanceof Set) {
        backLink.delete(sourceNodeId);
      } else {
        node.referencedBy.delete(sourceNode.type);
      }

      this.notifySubscribers(reference);
    }

    this.notifySubscribers(sourceNodeId);
  }

  /**
   * Adds a subscription to a node
   * @param nodeId The ID of the node to subscribe to
   * @param subscription The subscription callback function
   * @returns A function to unsubscribe
   */
  subscribe(nodeId: string, subscription: NodeSubscription): () => void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node with id ${nodeId} does not exist`);
    }

    node.subscriptions.add(subscription);

    // Return an unsubscribe function
    return () => {
      node.subscriptions.delete(subscription);
    };
  }

  /**
   * Removes a node and all its links from the graph
   * @param nodeId The ID of the node to remove
   */
  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return; // Node doesn't exist, nothing to do
    }

    // Remove all incoming links
    Array.from(node.referencedBy.entries()).forEach(([linkName, backLink]) => {
      const nodesToUpdate =
        backLink instanceof Set ? Array.from(backLink.values()) : [backLink];

      nodesToUpdate.forEach((nodeId) => {
        const node = this.nodes.get(nodeId);

        if (!node) return;

        const reference = node.references.get(linkName);

        if (!reference) return;

        node.references.delete(linkName);

        this.notifySubscribers(nodeId);
      });
    });

    // Remove the node itself
    this.nodes.delete(nodeId);
  }

  /**
   * Updates a node and notifies its subscribers
   * @param nodeId The ID of the node to update
   * @param updater A function that updates the node
   */
  updateNode(nodeId: string, updater: (node: GraphNode) => void): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node with id ${nodeId} does not exist`);
    }

    updater(node);
    this.notifySubscribers(nodeId);
  }

  /**
   * Notifies all subscribers of a node that it has been updated
   * @param nodeId The ID of the node whose subscribers to notify
   */
  public notifySubscribers(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    Array.from(node.subscriptions).forEach((subscription) => {
      try {
        subscription(nodeId);
      } catch (error) {
        console.error(`Error in node subscription for node ${nodeId}:`, error);
      }
    });
  }

  /**
   * Gets all nodes in the graph
   * @returns An array of all nodes
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }
}
