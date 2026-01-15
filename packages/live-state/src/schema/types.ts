/** biome-ignore-all lint/complexity/noBannedTypes: false positive */

/**
 * Base metadata type for live types.
 * All metadata types must extend this base.
 */
export type BaseMeta = {};

/**
 * Metadata type for atomic live types with timestamp for LWW conflict resolution.
 */
export type AtomicMeta = {
	timestamp: string | null;
} & BaseMeta;

export type MutationType = "set"; // | "delete"

/**
 * Describes the storage field type for database mapping.
 */
export type StorageFieldType = {
	type: string;
	nullable: boolean;
	default?: any;
	unique?: boolean;
	index?: boolean;
	primary?: boolean;
	references?: string;
};

/**
 * Materialized representation of a LiveType value with metadata.
 * Used internally for storage and sync operations.
 */
export type MaterializedLiveType<T extends LiveTypeAny> = {
	value: T["_value"] extends Record<string, LiveTypeAny>
		? {
				[K in keyof T["_value"]]: MaterializedLiveType<T["_value"][K]>;
			}
		: T["_value"];
	_meta: T["_meta"];
};

/**
 * Abstract base class for all live types.
 *
 * @template Value - The actual TypeScript value type
 * @template Meta - Metadata type for sync resolution (defaults to BaseMeta)
 * @template EncodeInput - Type accepted during mutations
 * @template DecodeInput - Type returned after encoding
 */
export abstract class LiveType<
	Value = any,
	Meta extends BaseMeta = BaseMeta,
	EncodeInput = Partial<Value> | Value,
	DecodeInput = {
		value: Value;
		_meta: keyof Meta extends never ? never : Meta;
	},
> {
	readonly _value!: Value;
	readonly _meta!: Meta;
	readonly _encodeInput!: EncodeInput;
	readonly _decodeInput!: DecodeInput;

	abstract encodeMutation(
		mutationType: MutationType,
		input: EncodeInput,
		timestamp: string
	): DecodeInput;

	/**
	 * Merges the materialized shape with the encoded mutation
	 * @param mutationType The type of mutation
	 * @param encodedMutation The encoded mutation
	 * @param materializedShape The materialized shape
	 * @returns A tuple of the new materialized shape and the accepted diff
	 */
	abstract mergeMutation(
		mutationType: MutationType,
		encodedMutation: DecodeInput,
		materializedShape?: MaterializedLiveType<LiveType<Value, Meta>>
	): [MaterializedLiveType<LiveType<Value, Meta>>, DecodeInput | null];

	abstract getStorageFieldType(): StorageFieldType;
}

export type LiveTypeAny = LiveType<any, BaseMeta, any, any>;

/**
 * Extracts the TypeScript value type from a LiveType.
 */
export type InferLiveType<T extends LiveTypeAny> =
	T["_value"] extends Record<string, LiveTypeAny>
		? {
				[K in keyof T["_value"]]: InferLiveType<T["_value"][K]>;
			}
		: T["_value"];

// TODO use proper index type
export type InferIndex<T extends LiveTypeAny> = string;

/** @deprecated Use `BaseMeta` instead */
export type LiveTypeMeta = BaseMeta;
