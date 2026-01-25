// Parser utilities
export {
	parse,
	getParser,
	isSupportedFile,
	getNodeText,
	getNodePosition,
	type SyntaxNode,
	type Tree,
} from "./parser.js";

// AST utilities
export {
	walk,
	findAll,
	findFirst,
	findByType,
	findMethodCalls,
	getCallArguments,
	isObjectLiteral,
	getObjectProperties,
	getPropertyKeyName,
	isBooleanLiteral,
	getParentCall,
	type NodeVisitor,
} from "./ast.js";

// Transform utilities
export {
	applyReplacements,
	sortReplacements,
	replaceNode,
	wrapNode,
	insertBefore,
	insertAfter,
	replacementsOverlap,
	removeOverlappingReplacements,
	getIndentationAt,
	formatObject,
	type Replacement,
} from "./transform.js";
