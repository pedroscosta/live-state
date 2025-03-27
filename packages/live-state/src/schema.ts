import { ObjectMutation } from "./core/internals";

type LiveTypeMeta = {};

export type MutationType = "set" | "insert" | "update"; // | "delete"

abstract class LiveType<
  Value = any,
  Meta extends LiveTypeMeta = LiveTypeMeta,
  EncodeInput = Partial<Value> | Value,
  DecodeInput = string,
> {
  readonly _value!: Value;
  readonly _meta!: Meta;
  readonly _encodeInput!: EncodeInput;
  readonly _decodeInput!: DecodeInput;

  constructor() {
    this.optional = this.optional.bind(this);
  }

  abstract encode(
    mutationType: MutationType,
    input: EncodeInput,
    timestamp: string
  ): string;

  abstract decode(
    mutationType: MutationType,
    encodedMutation: DecodeInput,
    materializedShape?: MaterializedLiveType<LiveType<Value, Meta>>
  ): MaterializedLiveType<LiveType<Value, Meta>>;

  optional(): OptionalLiveType<this> {
    return new OptionalLiveType<this>();
  }
}

class OptionalLiveType<T extends LiveTypeAny> extends LiveType<
  T["_value"] | undefined,
  T["_meta"],
  T["_encodeInput"],
  T["_decodeInput"]
> {
  encode(
    mutationType: MutationType,
    input: T["_value"] | undefined,
    timestamp: string
  ): string {
    throw new Error("Method not implemented.");
  }
  decode(
    mutationType: MutationType,
    encodedMutation: T["_decodeInput"],
    materializedShape?:
      | MaterializedLiveType<
          LiveType<
            T["_value"] | undefined,
            T["_meta"],
            T["_value"] | Partial<T["_value"] | undefined>,
            T["_decodeInput"]
          >
        >
      | undefined
  ): MaterializedLiveType<
    LiveType<
      T["_value"] | undefined,
      T["_meta"],
      T["_value"] | Partial<T["_value"] | undefined>,
      T["_decodeInput"]
    >
  > {
    throw new Error("Method not implemented.");
  }
}

type LiveAtomicTypeMeta = {
  timestamp: string;
} & LiveTypeMeta;

abstract class LiveAtomicType<
  Value = any,
  Meta extends LiveAtomicTypeMeta = LiveAtomicTypeMeta,
  EncodeInput = Partial<Value> | Value,
> extends LiveType<Value, Meta, EncodeInput> {}

export class LiveNumber extends LiveAtomicType<number> {
  encode(
    mutationType: MutationType,
    input: Partial<number>,
    timestamp: string
  ) {
    if (mutationType !== "set")
      throw new Error("Mutation type not implemented.");

    return `${input};${timestamp}`;
  }

  decode(
    mutationType: MutationType,
    encodedMutation: string,
    materializedShape?: MaterializedLiveType<LiveNumber>
  ): MaterializedLiveType<LiveNumber> {
    const [value, ts] = encodedMutation.split(";");

    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(ts) >= 0
    )
      return materializedShape;

    return {
      value: Number(value),
      _meta: {
        timestamp: ts,
      },
    };
  }

  static create() {
    return new LiveNumber();
  }
}

export const number = LiveNumber.create;

export type InferLiveObject<T extends Record<string, LiveTypeAny>> = {
  [K in keyof T]: InferLiveType<T[K]>;
};

export type LiveObjectMutation<TSchema extends Record<string, LiveTypeAny>> = {
  value: Partial<InferLiveObject<TSchema>>;
  where?: Record<string, any>; // TODO Infer indexable types
};

export class LiveObject<
  TSchema extends Record<string, LiveTypeAny>,
> extends LiveType<
  TSchema,
  LiveTypeMeta,
  LiveObjectMutation<TSchema>,
  Record<string, any>
> {
  public readonly fields: TSchema;

  constructor(fields: TSchema) {
    super();
    this.fields = fields;
  }

  encode(
    mutationType: MutationType,
    input: LiveObjectMutation<TSchema>,
    timestamp: string
  ): string {
    if (mutationType === "set") throw new Error("Method not implemented.");

    return JSON.stringify({
      type: mutationType,
      values: Object.fromEntries(
        Object.entries(input.value).map(([key, value]) => [
          key,
          this.fields[key].encode("set", value, timestamp),
        ])
      ),
      where: input.where,
    } satisfies ObjectMutation);
  }

  decode(
    mutationType: MutationType,
    encodedMutations: Record<string, any>,
    materializedShape?: MaterializedLiveType<this> | undefined
  ): MaterializedLiveType<this> {
    if (mutationType === "insert") {
      // TODO Enable this again
      // if (materializedShape) throw new Error("Insert conflict");

      return {
        value: Object.fromEntries(
          Object.entries(encodedMutations).map(([key, value]) => [
            key,
            this.fields[key].decode(mutationType, value),
          ])
        ),
      } as MaterializedLiveType<this>;
    } else if (mutationType === "update") {
      if (!materializedShape) throw new Error("Missing previous value");

      return {
        value: {
          ...materializedShape.value,
          ...Object.fromEntries(
            Object.entries(encodedMutations).map(([key, value]) => [
              key,
              this.fields[key].decode(
                mutationType,
                value,
                materializedShape.value[
                  key
                ] as MaterializedLiveType<LiveTypeAny>
              ),
            ])
          ),
        },
      } as MaterializedLiveType<this>;
    }

    throw new Error("Mutation type not implemented.");
  }

  static create<TSchema extends Record<string, LiveTypeAny>>(schema: TSchema) {
    return new LiveObject<TSchema>(schema);
  }
}

export const object = LiveObject.create;

export type LiveTypeAny = LiveType<any, LiveTypeMeta, any, any>;

/**
 * @deprecated
 */
export type Shape<T extends LiveTypeAny> = T;

/**
 * @deprecated
 */
export type AnyShape = Shape<LiveTypeAny>;

/**
 * @deprecated
 */
export type ShapeRecord = Record<string, AnyShape>;

/**
 * @deprecated
 */
export type ShapeNamesFromRecord<T extends ShapeRecord> = keyof T extends string
  ? keyof T
  : never;

export type InferLiveType<T extends LiveTypeAny> =
  T["_value"] extends Record<string, LiveTypeAny>
    ? {
        [K in keyof T["_value"]]: InferLiveType<T["_value"][K]>;
      }
    : T["_value"];

export type MaterializedLiveType<T extends LiveTypeAny> =
  keyof T["_meta"] extends never
    ? {
        value: T["_value"] extends Record<string, LiveTypeAny>
          ? {
              [K in keyof T["_value"]]: MaterializedLiveType<T["_value"][K]>;
            }
          : T["_value"];
      }
    : {
        value: T["_value"] extends Record<string, LiveTypeAny>
          ? {
              [K in keyof T["_value"]]: MaterializedLiveType<T["_value"][K]>;
            }
          : T["_value"];
        _meta: T["_meta"];
      };

export const inferValue = <T extends LiveTypeAny>(
  type: MaterializedLiveType<T>
): InferLiveType<T> => {
  if (typeof type.value !== "object") return type.value;

  return Object.fromEntries(
    Object.entries(type.value).map(([key, value]) => [
      key,
      inferValue(value as any),
    ])
  ) as InferLiveType<T>;
};

// TODO use proper index type
export type InferIndex<T extends LiveTypeAny> = number;
export type InferWhereClause<T extends LiveTypeAny> = Record<string, any>;
