import type { MaterializedLiveType } from ".";

export type LiveTypeMeta = {};

export type MutationType = "set"; // | "delete"

// DecodeInput extends {
//   value: Value;
//   _meta?: keyof Meta extends string ? Meta : never;
// } = { value: Value; _meta?: keyof Meta extends string ? Meta : never },

export type StorageFieldType = {
  type: string;
  nullable: boolean;
  default?: any;
  unique?: boolean;
  index?: boolean;
  primary?: boolean;
  references?: string;
};

export abstract class LiveType<
  Value = any,
  Meta extends LiveTypeMeta = LiveTypeMeta,
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

export type LiveTypeAny = LiveType<any, LiveTypeMeta, any, any>;

export type InferLiveType<T extends LiveTypeAny> =
  T["_value"] extends Record<string, LiveTypeAny>
    ? {
        [K in keyof T["_value"]]: InferLiveType<T["_value"][K]>;
      }
    : T["_value"];

// TODO use proper index type
export type InferIndex<T extends LiveTypeAny> = string;
