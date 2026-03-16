import type { SyntaxNode } from "./parser.js";

/**
 * Represents a text replacement in the source code
 */
export interface Replacement {
	startIndex: number;
	endIndex: number;
	newText: string;
	description?: string;
}

/**
 * Sort replacements by start index (descending)
 * This ensures we apply replacements from end to start, preserving indices
 */
export function sortReplacements(replacements: Replacement[]): Replacement[] {
	return [...replacements].sort((a, b) => b.startIndex - a.startIndex);
}

/**
 * Apply replacements to source code
 * Replacements should be sorted in descending order by startIndex
 */
export function applyReplacements(
	source: string,
	replacements: Replacement[]
): string {
	let result = source;
	const sorted = sortReplacements(replacements);

	for (const replacement of sorted) {
		result =
			result.slice(0, replacement.startIndex) +
			replacement.newText +
			result.slice(replacement.endIndex);
	}

	return result;
}

/**
 * Create a replacement for a node
 */
export function replaceNode(
	node: SyntaxNode,
	newText: string,
	description?: string
): Replacement {
	return {
		startIndex: node.startIndex,
		endIndex: node.endIndex,
		newText,
		description,
	};
}

/**
 * Create a replacement that wraps a node's content
 */
export function wrapNode(
	node: SyntaxNode,
	prefix: string,
	suffix: string,
	description?: string
): Replacement {
	return {
		startIndex: node.startIndex,
		endIndex: node.endIndex,
		newText: `${prefix}${node.text}${suffix}`,
		description,
	};
}

/**
 * Create an insertion before a node
 */
export function insertBefore(
	node: SyntaxNode,
	text: string,
	description?: string
): Replacement {
	return {
		startIndex: node.startIndex,
		endIndex: node.startIndex,
		newText: text,
		description,
	};
}

/**
 * Create an insertion after a node
 */
export function insertAfter(
	node: SyntaxNode,
	text: string,
	description?: string
): Replacement {
	return {
		startIndex: node.endIndex,
		endIndex: node.endIndex,
		newText: text,
		description,
	};
}

/**
 * Check if two replacements overlap
 */
export function replacementsOverlap(a: Replacement, b: Replacement): boolean {
	return !(a.endIndex <= b.startIndex || b.endIndex <= a.startIndex);
}

/**
 * Filter out overlapping replacements, keeping the first ones
 */
export function removeOverlappingReplacements(
	replacements: Replacement[]
): Replacement[] {
	const sorted = sortReplacements(replacements);
	const result: Replacement[] = [];

	for (const replacement of sorted) {
		const hasOverlap = result.some((r) => replacementsOverlap(r, replacement));
		if (!hasOverlap) {
			result.push(replacement);
		}
	}

	return result;
}

/**
 * Get indentation at a given position in the source
 */
export function getIndentationAt(source: string, index: number): string {
	// Find the start of the line
	let lineStart = index;
	while (lineStart > 0 && source[lineStart - 1] !== "\n") {
		lineStart--;
	}

	// Extract leading whitespace
	let indent = "";
	for (let i = lineStart; i < source.length && /\s/.test(source[i]); i++) {
		if (source[i] === "\n") break;
		indent += source[i];
	}

	return indent;
}

/**
 * Format an object literal with proper indentation
 */
export function formatObject(
	properties: { key: string; value: string }[],
	baseIndent: string,
	indentChar = "\t"
): string {
	if (properties.length === 0) {
		return "{}";
	}

	if (properties.length === 1 && !properties[0].value.includes("\n")) {
		return `{ ${properties[0].key}: ${properties[0].value} }`;
	}

	const lines = properties.map(
		(p) => `${baseIndent}${indentChar}${p.key}: ${p.value}`
	);
	return `{\n${lines.join(",\n")}\n${baseIndent}}`;
}
