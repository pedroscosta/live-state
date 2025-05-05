// Generic tree node structure
interface TreeNode<T> {
  children: Map<string, TreeNode<T>>;
  values?: Set<T>; // Only present at end nodes
}

export class Tree<T> {
  private root: TreeNode<T> = { children: new Map() };

  /**
   * Add a value to the set at the given path (e.g., ['a','b','c'])
   */
  add(path: string[], value: T) {
    let node = this.root;
    for (const part of path) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map() });
      }
      node = node.children.get(part)!;
    }
    if (!node.values) node.values = new Set();
    node.values.add(value);
  }

  /**
   * Get the set at the given path, or undefined if none exists
   */
  get(path: string[]): Set<T> | undefined {
    const node = this.getNode(path);
    return node?.values;
  }

  /**
   * Remove a value from the set at the given path. Prunes empty nodes.
   */
  remove(path: string[], value: T) {
    this.removeHelper(this.root, path, value, 0);
  }

  private removeHelper(node: TreeNode<T>, path: string[], value: T, depth: number): boolean {
    if (depth === path.length) {
      if (node.values) {
        node.values.delete(value);
        if (node.values.size === 0) delete node.values;
      }
      return (!node.values || node.values.size === 0) && node.children.size === 0;
    }
    const part = path[depth];
    const child = node.children.get(part);
    if (!child) return false;
    const shouldDeleteChild = this.removeHelper(child, path, value, depth + 1);
    if (shouldDeleteChild) {
      node.children.delete(part);
    }
    return (!node.values || node.values.size === 0) && node.children.size === 0;
  }

  /**
   * Get a flattened set of all T under a given path (including the node at the path itself, if it has a set)
   */
  getAllUnder(path: string[]): Set<T> {
    const node = this.getNode(path);
    const result = new Set<T>();
    if (!node) return result;
    this.collectAllFlat(node, result);
    return result;
  }

  /**
   * Get a flattened set of all T from the root to the given path (including the node at the path itself, if it has a set)
   */
  getAllAbove(path: string[]): Set<T> {
    const result = new Set<T>();
    let node = this.root;
    
    // Add values from root if any
    if (node.values) {
      node.values.forEach((v) => result.add(v));
    }
    
    // Traverse the path and collect values
    for (let i = 0; i < path.length; i++) {
      const part = path[i];
      const next = node.children.get(part);
      if (!next) break; // Path doesn't exist, return what we have so far
      
      node = next;
      if (node.values) {
        node.values.forEach((v) => result.add(v));
      }
    }
    
    return result;
  }

  // Helper: get node at path
  private getNode(path: string[]): TreeNode<T> | undefined {
    let node = this.root;
    for (const part of path) {
      const next = node.children.get(part);
      if (!next) return undefined;
      node = next;
    }
    return node;
  }

  // Helper: recursively collect all values under a node into a flat set
  private collectAllFlat(node: TreeNode<T>, out: Set<T>) {
    if (node.values) {
      node.values.forEach((v) => out.add(v));
    }
    node.children.forEach((child) => {
      this.collectAllFlat(child, out);
    });
  }
}