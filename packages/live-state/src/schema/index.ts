/** biome-ignore-all lint/complexity/noBannedTypes: false positive */

// Core types
export {
	LiveType,
	type LiveTypeAny,
	type BaseMeta,
	type AtomicMeta,
	type MutationType,
	type StorageFieldType,
	type MaterializedLiveType,
	type InferLiveType,
	type InferIndex,
	// Deprecated
	type LiveTypeMeta,
} from "./types";

// Atomic types
export {
	LiveAtomicType,
	NullableLiveType,
	LiveNumber,
	LiveString,
	LiveBoolean,
	LiveTimestamp,
	LiveEnum,
	LiveJson,
	// Factory functions
	number,
	string,
	boolean,
	timestamp,
	id,
	reference,
	enumType,
	json,
} from "./atomic";

// Relations
export {
	Relation,
	createRelations,
	type RelationAny,
	type RelationConnectors,
	type RelationsDecl,
	type LiveCollectionAny as _ILiveCollectionAny,
} from "./relations";

// Collection
export {
	LiveCollection,
	collection,
	type LiveCollectionAny,
	type LiveCollectionMutationInput,
	type CollectionConfig,
	// Deprecated
	object,
	LiveObject,
	type LiveObjectAny,
	type LiveObjectMutationInput,
} from "./collection";

// Clauses
export {
	type WhereClause,
	type SubQueryInclude,
	type IncludeClause,
} from "./clauses";

// Type inference
export {
	inferValue,
	type InferLiveCollection,
	type InferLiveCollectionWithoutRelations,
	type InferLiveCollectionWithRelationalIds,
	type InferInsert,
	type InferUpdate,
	// Deprecated
	type InferLiveObject,
	type InferLiveObjectWithoutRelations,
	type InferLiveObjectWithRelationalIds,
} from "./infer";

// Schema
export { createSchema, type Schema } from "./schema";
