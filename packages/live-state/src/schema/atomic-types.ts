import { MaterializedLiveType } from ".";
import {
  LiveType,
  LiveTypeAny,
  LiveTypeMeta,
  MutationType,
  StorageFieldType,
} from "./live-type";

class OptionalLiveType<T extends LiveTypeAny> extends LiveType<
  T["_value"] | undefined,
  T["_meta"],
  T["_encodeInput"],
  T["_decodeInput"]
> {
  readonly inner: T;

  constructor(inner: T) {
    super();
    this.inner = inner;
  }

  encodeMutation(
    mutationType: MutationType,
    input: T["_value"] | undefined,
    timestamp: string
  ): T["_decodeInput"] {
    return this.inner.encodeMutation(mutationType, input, timestamp);
  }

  mergeMutation(
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
  ): [
    MaterializedLiveType<
      LiveType<
        T["_value"] | undefined,
        T["_meta"],
        T["_value"] | Partial<T["_value"] | undefined>,
        T["_decodeInput"]
      >
    >,
    T["_decodeInput"] | null,
  ] {
    return this.inner.mergeMutation(
      mutationType,
      encodedMutation,
      materializedShape
    ) as [
      MaterializedLiveType<
        LiveType<
          T["_value"] | undefined,
          T["_meta"],
          T["_value"] | Partial<T["_value"] | undefined>,
          T["_decodeInput"]
        >
      >,
      T["_decodeInput"] | null,
    ];
  }

  getStorageFieldType(): StorageFieldType {
    return {
      ...this.inner.getStorageFieldType(),
      nullable: true,
    };
  }
}

type LiveAtomicTypeMeta = {
  timestamp: string;
} & LiveTypeMeta;

class LiveAtomicType<Value> extends LiveType<
  Value,
  LiveAtomicTypeMeta,
  Value,
  { value: Value; _meta: LiveAtomicTypeMeta }
> {
  readonly storageType: string;
  readonly convertFunc?: (value: any) => Value;
  readonly isIndex: boolean;
  readonly isUnique: boolean;
  readonly defaultValue?: Value;
  readonly foreignReference?: string;
  readonly isPrimary: boolean;

  constructor(
    storageType: string,
    convertFunc?: (value: any) => Value,
    index?: boolean,
    unique?: boolean,
    defaultValue?: Value,
    references?: string,
    primary?: boolean
  ) {
    super();
    this.storageType = storageType;
    this.convertFunc = convertFunc;
    this.isIndex = index ?? false;
    this.isUnique = unique ?? false;
    this.defaultValue = defaultValue;
    this.foreignReference = references;
    this.isPrimary = primary ?? false;
  }

  encodeMutation(
    mutationType: MutationType,
    input: Value,
    timestamp: string
  ): { value: Value; _meta: LiveAtomicTypeMeta } {
    return {
      value: input,
      _meta: {
        timestamp,
      },
    };
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: {
      value: Value;
      _meta: LiveAtomicTypeMeta;
    },
    materializedShape?: MaterializedLiveType<
      LiveType<
        Value,
        LiveAtomicTypeMeta,
        Value | Partial<Value>,
        { value: Value; _meta: LiveAtomicTypeMeta }
      >
    >
  ): [
    MaterializedLiveType<
      LiveType<
        Value,
        LiveAtomicTypeMeta,
        Value | Partial<Value>,
        { value: Value; _meta: LiveAtomicTypeMeta }
      >
    >,
    { value: Value; _meta: LiveAtomicTypeMeta } | null,
  ] {
    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(
        encodedMutation._meta.timestamp
      ) >= 0
    )
      return [materializedShape, null];

    return [
      {
        value: (this.convertFunc
          ? this.convertFunc(encodedMutation.value)
          : encodedMutation.value) as MaterializedLiveType<
          LiveType<
            Value,
            LiveAtomicTypeMeta,
            Value | Partial<Value>,
            { value: Value; _meta: LiveAtomicTypeMeta }
          >
        >["value"],
        _meta: encodedMutation._meta,
      },
      encodedMutation,
    ];
  }

  getStorageFieldType(): StorageFieldType {
    return {
      type: this.storageType,
      nullable: false,
      index: this.isIndex,
      unique: this.isUnique,
      default: this.defaultValue,
      references: this.foreignReference,
      primary: this.isPrimary,
    };
  }

  unique() {
    return new LiveAtomicType<Value>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      true,
      this.defaultValue,
      this.foreignReference,
      this.isPrimary
    );
  }

  index() {
    return new LiveAtomicType<Value>(
      this.storageType,
      this.convertFunc,
      true,
      this.isUnique,
      this.defaultValue,
      this.foreignReference,
      this.isPrimary
    );
  }

  default(value: Value) {
    return new LiveAtomicType<Value>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      this.isUnique,
      value,
      this.foreignReference,
      this.isPrimary
    );
  }

  primary() {
    return new LiveAtomicType<Value>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      this.isUnique,
      this.defaultValue,
      this.foreignReference,
      true
    );
  }

  optional(): OptionalLiveType<this> {
    return new OptionalLiveType<this>(this);
  }
}

export class LiveNumber extends LiveAtomicType<number> {
  private constructor() {
    super("integer", (value) => Number(value));
  }

  static create() {
    return new LiveNumber();
  }
}

export const number = LiveNumber.create;
export class LiveString extends LiveAtomicType<string> {
  private constructor(reference?: string) {
    super("varchar", undefined, undefined, undefined, undefined, reference);
  }

  static create() {
    return new LiveString();
  }

  static createId() {
    return new LiveString().index().unique().primary();
  }

  static createReference(foreignField: `${string}.${string}`) {
    return new LiveString(foreignField);
  }
}

export const string = LiveString.create;
export const id = LiveString.createId;
export const reference = LiveString.createReference;

export class LiveBoolean extends LiveAtomicType<boolean> {
  private constructor() {
    super("boolean", (value) => Boolean(value));
  }

  static create() {
    return new LiveBoolean();
  }
}

export const boolean = LiveBoolean.create;

// TODO re-implement this
// export class LiveEnum<T extends string> extends LiveAtomicType<T> {
//   private constructor(private readonly values: readonly T[]) {
//     super("varchar", (value) => {
//       if (!values.includes(value as T)) {
//         throw new Error(
//           `Invalid enum value: ${value}. Expected one of: ${values.join(", ")}`
//         );
//       }
//       return value as T;
//     });
//   }

//   static create<T extends string>(values: readonly T[]) {
//     return new LiveEnum<T>(values);
//   }
// }

// export const enum_of = LiveEnum.create;

export class LiveTimestamp extends LiveAtomicType<Date> {
  private constructor() {
    super("timestamp", (value) => {
      if (typeof value === "string") {
        return new Date(value);
      }
      return value;
    });
  }

  static create() {
    return new LiveTimestamp();
  }
}

export const timestamp = LiveTimestamp.create;
