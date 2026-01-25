import type { SyntaxNode } from "./parser.js";

/**
 * Callback for node visitors
 */
export type NodeVisitor = (node: SyntaxNode) => void | boolean;

/**
 * Walk the AST depth-first, calling the visitor for each node
 * If the visitor returns false, children are not visited
 */
export function walk(node: SyntaxNode, visitor: NodeVisitor): void {
	const result = visitor(node);
	if (result === false) return;

	for (const child of node.children) {
		walk(child, visitor);
	}
}

/**
 * Find all nodes matching a predicate
 */
export function findAll(
	node: SyntaxNode,
	predicate: (node: SyntaxNode) => boolean
): SyntaxNode[] {
	const results: SyntaxNode[] = [];

	walk(node, (n) => {
		if (predicate(n)) {
			results.push(n);
		}
	});

	return results;
}

/**
 * Find the first node matching a predicate
 */
export function findFirst(
	node: SyntaxNode,
	predicate: (node: SyntaxNode) => boolean
): SyntaxNode | null {
	let result: SyntaxNode | null = null;

	walk(node, (n) => {
		if (predicate(n)) {
			result = n;
			return false; // Stop walking
		}
	});

	return result;
}

/**
 * Find all nodes of a specific type
 */
export function findByType(node: SyntaxNode, type: string): SyntaxNode[] {
	return findAll(node, (n) => n.type === type);
}

/**
 * Find all call expressions with a specific method name
 * e.g., findMethodCalls(node, "include") finds all .include(...) calls
 */
export function findMethodCalls(
	node: SyntaxNode,
	methodName: string
): SyntaxNode[] {
	return findAll(node, (n) => {
		if (n.type !== "call_expression") return false;

		const func = n.childForFieldName("function");
		if (!func || func.type !== "member_expression") return false;

		const property = func.childForFieldName("property");
		return property?.text === methodName;
	});
}

/**
 * Get the arguments of a call expression
 */
export function getCallArguments(callNode: SyntaxNode): SyntaxNode[] {
	const args = callNode.childForFieldName("arguments");
	if (!args) return [];

	return args.children.filter(
		(child) => child.type !== "(" && child.type !== ")" && child.type !== ","
	);
}

/**
 * Check if a node is an object literal
 */
export function isObjectLiteral(node: SyntaxNode): boolean {
	return node.type === "object";
}

/**
 * Get properties from an object literal node
 */
export function getObjectProperties(
	node: SyntaxNode
): { key: SyntaxNode; value: SyntaxNode; node: SyntaxNode }[] {
	if (node.type !== "object") return [];

	const properties: { key: SyntaxNode; value: SyntaxNode; node: SyntaxNode }[] =
		[];

	for (const child of node.children) {
		if (child.type === "pair") {
			const key = child.childForFieldName("key");
			const value = child.childForFieldName("value");
			if (key && value) {
				properties.push({ key, value, node: child });
			}
		} else if (child.type === "shorthand_property_identifier") {
			// Handle shorthand: { foo } is equivalent to { foo: foo }
			properties.push({ key: child, value: child, node: child });
		}
	}

	return properties;
}

/**
 * Get the key name from a property key node
 */
export function getPropertyKeyName(keyNode: SyntaxNode): string {
	// Handle different key types: identifier, string, computed
	if (keyNode.type === "property_identifier") {
		return keyNode.text;
	}
	if (keyNode.type === "string") {
		// Remove quotes
		return keyNode.text.slice(1, -1);
	}
	if (keyNode.type === "shorthand_property_identifier") {
		return keyNode.text;
	}
	return keyNode.text;
}

/**
 * Check if a node is a boolean literal
 */
export function isBooleanLiteral(node: SyntaxNode): boolean {
	return node.type === "true" || node.type === "false";
}

/**
 * Get the parent call expression of a node (if any)
 */
export function getParentCall(node: SyntaxNode): SyntaxNode | null {
	let current: SyntaxNode | null = node.parent;
	while (current) {
		if (current.type === "call_expression") {
			return current;
		}
		current = current.parent;
	}
	return null;
}
