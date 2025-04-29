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
  ): DecodeInput;

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

export class LiveString extends LiveAtomicType<string> {
  encode(
    mutationType: MutationType,
    input: Partial<string>,
    timestamp: string
  ) {
    if (mutationType !== "set")
      throw new Error("Mutation type not implemented.");

    return `${input};${timestamp}`;
  }

  decode(
    mutationType: MutationType,
    encodedMutation: string,
    materializedShape?: MaterializedLiveType<LiveString>
  ): MaterializedLiveType<LiveString> {
    const [value, ts] = encodedMutation.split(";");

    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(ts) >= 0
    )
      return materializedShape;

    return {
      value: value,
      _meta: {
        timestamp: ts,
      },
    };
  }

  static create() {
    return new LiveString();
  }
}

export const string = LiveString.create;

export type InferLiveObject<T extends Record<string, LiveTypeAny>> = {
  [K in keyof T]: InferLiveType<T[K]>;
};

export type LiveObjectMutation<TSchema extends Record<string, LiveTypeAny>> = {
  value: Partial<InferLiveObject<TSchema>>;
  where?: Record<string, any>; // TODO Infer indexable types
};

export type LiveObjectInsertMutation<TObject extends LiveObject<any>> = {
  value: InferLiveObject<TObject["_value"]>;
};

export type LiveObjectUpdateMutation<TObject extends LiveObject<any>> = {
  value: Partial<InferLiveObject<TObject["_value"]>>;
  id: string;
};

type MutationUnion<TObject extends LiveObject<any>> =
  | LiveObjectInsertMutation<TObject>
  | LiveObjectUpdateMutation<TObject>;

export class LiveObject<
  TSchema extends Record<string, LiveTypeAny>,
> extends LiveType<
  TSchema,
  LiveTypeMeta,
  MutationUnion<LiveObject<TSchema>>,
  Record<string, any>
> {
  public readonly name: string;
  public readonly fields: TSchema;

  constructor(name: string, fields: TSchema) {
    super();
    this.name = name;
    this.fields = fields;
  }

  encode(
    mutationType: MutationType,
    input: MutationUnion<this>,
    timestamp: string
  ): Record<string, any> {
    if (mutationType === "set") throw new Error("Method not implemented.");

    return Object.fromEntries(
      Object.entries(input.value).map(([key, value]) => [
        key,
        this.fields[key].encode("set", value, timestamp),
      ])
    );
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

  static create<TSchema extends Record<string, LiveTypeAny>>(
    name: string,
    schema: TSchema
  ) {
    return new LiveObject<TSchema>(name, schema);
  }
}

export const object = LiveObject.create;

export type LiveObjectAny = LiveObject<Record<string, LiveTypeAny>>;

export type LiveTypeAny = LiveType<any, LiveTypeMeta, any, any>;

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
export type InferIndex<T extends LiveTypeAny> = string;
export type InferWhereClause<T extends LiveTypeAny> = string[];

export type Schema = {
  entities: LiveObjectAny[];
};
