type LiveTypeMeta = {};

export type MutationType = "set"; // | "insert" | "update" | "delete"

abstract class LiveType<
  Value = any,
  Meta extends LiveTypeMeta = LiveTypeMeta,
  EncodeInput = Partial<Value> | Value,
> {
  readonly _value!: Value;
  readonly _meta!: Meta;

  constructor() {
    this.optional = this.optional.bind(this);
  }

  abstract encode(
    mutationType: MutationType,
    input: EncodeInput,
    timestamp: string
  ): string;

  abstract decode(
    encodedMutation: string,
    materializedShape?: MaterializedLiveType<LiveType<Value, Meta>>
  ): MaterializedLiveType<LiveType<Value, Meta>>;

  optional(): OptionalLiveType<this> {
    return new OptionalLiveType<this>();
  }
}

class OptionalLiveType<T extends LiveTypeAny> extends LiveType<
  T["_value"] | undefined,
  T["_meta"],
  T["_value"] | undefined
> {
  encode(
    mutationType: MutationType,
    input: T["_value"] | undefined,
    timestamp: string
  ): string {
    throw new Error("Method not implemented.");
  }
  decode(
    encodedMutation: string,
    materializedShape?:
      | MaterializedLiveType<
          LiveType<
            T["_value"] | undefined,
            T["_meta"],
            T["_value"] | Partial<T["_value"] | undefined>
          >
        >
      | undefined
  ): MaterializedLiveType<
    LiveType<
      T["_value"] | undefined,
      T["_meta"],
      T["_value"] | Partial<T["_value"] | undefined>
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
  encode(mutationName: string, input: Partial<number>, timestamp: string) {
    return `${mutationName};${input};${timestamp}`;
  }

  decode(
    encodedMutation: string,
    materializedShape?: MaterializedLiveType<LiveNumber>
  ): MaterializedLiveType<LiveNumber> {
    const [_route, value_, timestamp_] = encodedMutation.split(";");

    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(timestamp_) >= 0
    )
      return materializedShape;

    return {
      value: Number(value_),
      _meta: {
        timestamp: timestamp_,
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

export class LiveObject<
  TSchema extends Record<string, LiveTypeAny>,
> extends LiveType<TSchema, LiveTypeMeta, InferLiveObject<TSchema>> {
  encode(
    mutationType: MutationType,
    input: Partial<InferLiveObject<TSchema>>,
    timestamp: string
  ): string {
    if (mutationType !== "set") throw new Error("Method not implemented.");

    return `${mutationType};${JSON.stringify(input)};${timestamp}`;
  }

  decode(
    encodedMutation: string,
    materializedShape?:
      | MaterializedLiveType<LiveType<TSchema, LiveTypeMeta>>
      | undefined
  ): MaterializedLiveType<LiveType<TSchema, LiveTypeMeta>> {
    throw new Error("Method not implemented.");
  }

  static create<TSchema extends Record<string, LiveTypeAny>>(schema: TSchema) {
    return new LiveObject<TSchema>();
  }
}

export const table = LiveObject.create;

export type LiveTypeAny = LiveType<any>;

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

export type MaterializedLiveType<T extends AnyShape> =
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
