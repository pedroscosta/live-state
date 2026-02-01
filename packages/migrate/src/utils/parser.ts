import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

// Initialize parsers for TypeScript and TSX
const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx);

/**
 * Get the appropriate parser based on file extension
 */
export function getParser(filePath: string): Parser {
	if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
		return tsxParser;
	}
	return tsParser;
}

/**
 * Parse source code into an AST
 */
export function parse(source: string, filePath: string): Tree {
	const parser = getParser(filePath);
	return parser.parse(source);
}

/**
 * Check if a file is a TypeScript/JavaScript file
 */
export function isSupportedFile(filePath: string): boolean {
	return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath);
}

/**
 * Get the text content of a node from the source
 */
export function getNodeText(node: SyntaxNode, source: string): string {
	return source.slice(node.startIndex, node.endIndex);
}

/**
 * Get the source position info for a node
 */
export function getNodePosition(node: SyntaxNode): {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	startIndex: number;
	endIndex: number;
} {
	return {
		startLine: node.startPosition.row + 1,
		startColumn: node.startPosition.column,
		endLine: node.endPosition.row + 1,
		endColumn: node.endPosition.column,
		startIndex: node.startIndex,
		endIndex: node.endIndex,
	};
}
