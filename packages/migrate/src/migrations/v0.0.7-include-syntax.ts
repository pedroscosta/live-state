import type { Migration, MigrationResult } from "../types.js";
import {
	parse,
	isSupportedFile,
	getNodeText,
	findMethodCalls,
	getCallArguments,
	isObjectLiteral,
	getObjectProperties,
	getPropertyKeyName,
	isBooleanLiteral,
	applyReplacements,
	replaceNode,
	type SyntaxNode,
	type Replacement,
} from "../utils/index.js";

/**
 * Migration to upgrade from the old nested include syntax to the new sub-query include syntax.
 *
 * Old syntax (deprecated):
 * ```typescript
 * .include({ posts: { author: true } })
 * ```
 *
 * New syntax:
 * ```typescript
 * .include({ posts: { include: { author: true } } })
 * ```
 */
export const includesSyntaxMigration: Migration = {
	id: "v0.0.7-include-syntax",
	name: "Include Syntax Migration",
	description:
		"Upgrades from old nested include syntax to new sub-query include syntax",
	fromVersion: "0.0.6",
	toVersion: "0.0.7",
	migrate,
};

// Keys that indicate new sub-query include syntax
const SUB_QUERY_KEYS = new Set(["where", "limit", "orderBy", "include"]);

function migrate(content: string, filePath: string): MigrationResult {
	const changes: string[] = [];
	const warnings: string[] = [];

	// Skip unsupported files
	if (!isSupportedFile(filePath)) {
		return { modified: false, content, changes, warnings };
	}

	// Parse the source code
	const tree = parse(content, filePath);

	// Find all .include() calls
	const includeCalls = findMethodCalls(tree.rootNode, "include");

	if (includeCalls.length === 0) {
		return { modified: false, content, changes, warnings };
	}

	const replacements: Replacement[] = [];

	for (const call of includeCalls) {
		const args = getCallArguments(call);

		// We expect a single object argument
		if (args.length !== 1 || !isObjectLiteral(args[0])) {
			continue;
		}

		const includeObject = args[0];
		const transformed = transformIncludeObject(includeObject, content);

		if (transformed.changed) {
			replacements.push(
				replaceNode(
					includeObject,
					transformed.newText,
					`Transformed include at line ${includeObject.startPosition.row + 1}`
				)
			);
			changes.push(
				`Line ${includeObject.startPosition.row + 1}: Upgraded nested include syntax`
			);
		}
	}

	if (replacements.length === 0) {
		return { modified: false, content, changes, warnings };
	}

	const newContent = applyReplacements(content, replacements);

	return {
		modified: true,
		content: newContent,
		changes,
		warnings,
	};
}

interface TransformResult {
	changed: boolean;
	newText: string;
}

/**
 * Transform an include object from old syntax to new syntax
 */
function transformIncludeObject(
	node: SyntaxNode,
	source: string
): TransformResult {
	const properties = getObjectProperties(node);

	if (properties.length === 0) {
		return { changed: false, newText: getNodeText(node, source) };
	}

	let anyChanged = false;
	const newProperties: string[] = [];

	for (const prop of properties) {
		const keyName = getPropertyKeyName(prop.key);
		const value = prop.value;

		// If value is a boolean or non-object, keep as-is
		if (!isObjectLiteral(value)) {
			newProperties.push(getNodeText(prop.node, source));
			continue;
		}

		// Check if this is already a sub-query include (has where, limit, orderBy, or include)
		if (isSubQueryInclude(value)) {
			// Already new syntax, but check for nested includes that might need transformation
			const transformed = transformSubQueryInclude(value, source);
			if (transformed.changed) {
				anyChanged = true;
				newProperties.push(`${keyName}: ${transformed.newText}`);
			} else {
				newProperties.push(getNodeText(prop.node, source));
			}
		} else {
			// Old nested include syntax - needs to be wrapped with { include: ... }
			const nestedTransform = transformIncludeObject(value, source);
			anyChanged = true;
			newProperties.push(`${keyName}: { include: ${nestedTransform.newText} }`);
		}
	}

	if (!anyChanged) {
		return { changed: false, newText: getNodeText(node, source) };
	}

	// Reconstruct the object
	const newText = formatObjectFromProperties(newProperties, node, source);
	return { changed: true, newText };
}

/**
 * Check if an object node represents a sub-query include (new syntax)
 */
function isSubQueryInclude(node: SyntaxNode): boolean {
	const properties = getObjectProperties(node);

	for (const prop of properties) {
		const keyName = getPropertyKeyName(prop.key);
		if (SUB_QUERY_KEYS.has(keyName)) {
			return true;
		}
	}

	return false;
}

/**
 * Transform nested includes within a sub-query include object
 */
function transformSubQueryInclude(
	node: SyntaxNode,
	source: string
): TransformResult {
	const properties = getObjectProperties(node);
	let anyChanged = false;
	const newProperties: string[] = [];

	for (const prop of properties) {
		const keyName = getPropertyKeyName(prop.key);
		const value = prop.value;

		if (keyName === "include" && isObjectLiteral(value)) {
			// Recursively transform the nested include
			const transformed = transformIncludeObject(value, source);
			if (transformed.changed) {
				anyChanged = true;
				newProperties.push(`${keyName}: ${transformed.newText}`);
			} else {
				newProperties.push(getNodeText(prop.node, source));
			}
		} else {
			newProperties.push(getNodeText(prop.node, source));
		}
	}

	if (!anyChanged) {
		return { changed: false, newText: getNodeText(node, source) };
	}

	const newText = formatObjectFromProperties(newProperties, node, source);
	return { changed: true, newText };
}

/**
 * Format an object from property strings, preserving original formatting style
 */
function formatObjectFromProperties(
	properties: string[],
	originalNode: SyntaxNode,
	source: string
): string {
	const originalText = getNodeText(originalNode, source);

	// Check if the original was single-line or multi-line
	const isMultiLine = originalText.includes("\n");

	if (!isMultiLine || properties.length <= 1) {
		// Single-line format
		return `{ ${properties.join(", ")} }`;
	}

	// Multi-line format - try to preserve indentation
	const indent = detectIndentation(originalNode, source);
	const innerIndent = indent + detectIndentChar(source);

	const formattedProps = properties.map((p) => `${innerIndent}${p.trim()}`);
	return `{\n${formattedProps.join(",\n")}\n${indent}}`;
}

/**
 * Detect the indentation level of a node
 */
function detectIndentation(node: SyntaxNode, source: string): string {
	const lineStart = source.lastIndexOf("\n", node.startIndex) + 1;
	let indent = "";

	for (let i = lineStart; i < node.startIndex; i++) {
		const char = source[i];
		if (char === " " || char === "\t") {
			indent += char;
		} else {
			break;
		}
	}

	return indent;
}

/**
 * Detect the indent character used in the source (tab or spaces)
 */
function detectIndentChar(source: string): string {
	// Look for the first indented line
	const lines = source.split("\n");
	for (const line of lines) {
		if (line.startsWith("\t")) {
			return "\t";
		}
		if (line.startsWith("  ")) {
			// Count leading spaces
			let spaces = 0;
			for (const char of line) {
				if (char === " ") spaces++;
				else break;
			}
			if (spaces >= 2) {
				return "  "; // Assume 2-space indent
			}
		}
	}
	return "\t"; // Default to tab
}

export default includesSyntaxMigration;
