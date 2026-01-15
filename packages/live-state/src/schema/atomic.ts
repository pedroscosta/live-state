import {
  type AtomicMeta,
  LiveType,
  type LiveTypeAny,
  type MaterializedLiveType,
  type MutationType,
  type StorageFieldType,
} from "./types";

/**
 * Helper type to extract Value type from LiveAtomicType
 */
type ExtractValue<T> = T extends LiveAtomicType<infer V, any, any> ? V : never;

/**
 * Helper type to extract Meta type from LiveAtomicType
 */
type ExtractMeta<T> = T extends LiveAtomicType<any, any, infer M> ? M : AtomicMeta;

/**
 * Wraps a LiveAtomicType to allow null values.
 * Supports chainable modifiers like `.default()`, `.unique()`, `.index()`, `.primary()`.
 */
export class NullableLiveType<
  T extends LiveAtomicType<any, any, any>,
> extends LiveType<
  T["_value"] | null,
  T["_meta"],
  T["_encodeInput"] | null,
  T["_decodeInput"]
> {
  readonly inner: T;

  constructor(inner: T) {
    super();
    this.inner = inner;
  }

  encodeMutation(
    mutationType: MutationType,
    input: T["_value"] | null,
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
            T["_value"] | null,
            T["_meta"],
            T["_value"] | Partial<T["_value"] | null>,
            T["_decodeInput"]
          >
        >
      | undefined
  ): [
    MaterializedLiveType<
      LiveType<
        T["_value"] | null,
        T["_meta"],
        T["_value"] | Partial<T["_value"] | null>,
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
          T["_value"] | null,
          T["_meta"],
          T["_value"] | Partial<T["_value"] | null>,
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

  /**
   * Returns a new nullable type with a unique constraint.
   */
  unique(): NullableLiveType<
    LiveAtomicType<ExtractValue<T>, undefined, ExtractMeta<T>>
  > {
    return new NullableLiveType(this.inner.unique());
  }

  /**
   * Returns a new nullable type with an index.
   */
  index(): NullableLiveType<
    LiveAtomicType<ExtractValue<T>, undefined, ExtractMeta<T>>
  > {
    return new NullableLiveType(this.inner.index());
  }

  /**
   * Returns a new nullable type with a default value.
   * Can be the value type or null.
   */
  default(
    value: ExtractValue<T> | null
  ): NullableLiveType<
    LiveAtomicType<ExtractValue<T>, ExtractValue<T> | null, ExtractMeta<T>>
  > {
    const newInner = new LiveAtomicType<
      ExtractValue<T>,
      ExtractValue<T> | null,
      ExtractMeta<T>
    >(
      this.inner.storageType,
      this.inner.convertFunc,
      this.inner.isIndex,
      this.inner.isUnique,
      value,
      this.inner.foreignReference,
      this.inner.isPrimary
    );
    return new NullableLiveType(newInner);
  }

  /**
   * Returns a new nullable type marked as primary key.
   */
  primary(): NullableLiveType<
    LiveAtomicType<ExtractValue<T>, undefined, ExtractMeta<T>>
  > {
    return new NullableLiveType(this.inner.primary());
  }
}

/**
 * Base class for atomic (scalar) live types.
 *
 * @template Value - The value type (string, number, boolean, Date)
 * @template DefaultValue - The default value type (undefined if no default)
 * @template Meta - Metadata type for sync resolution
 */
export class LiveAtomicType<
  Value,
  DefaultValue = undefined,
  Meta extends AtomicMeta = AtomicMeta,
> extends LiveType<Value, Meta, Value, { value: Value; _meta: Meta }> {
  readonly storageType: string;
  readonly convertFunc?: (value: any) => Value;
  readonly isIndex: boolean;
  readonly isUnique: boolean;
  readonly defaultValue: DefaultValue;
  readonly foreignReference?: string;
  readonly isPrimary: boolean;

  constructor(
    storageType: string,
    convertFunc?: (value: any) => Value,
    index?: boolean,
    unique?: boolean,
    defaultValue?: DefaultValue,
    references?: string,
    primary?: boolean
  ) {
    super();
    this.storageType = storageType;
    this.convertFunc = convertFunc;
    this.isIndex = index ?? false;
    this.isUnique = unique ?? false;
    this.defaultValue = defaultValue as DefaultValue;
    this.foreignReference = references;
    this.isPrimary = primary ?? false;
  }

  encodeMutation(
    mutationType: MutationType,
    input: Value,
    timestamp: string
  ): { value: Value; _meta: Meta } {
    return {
      value: input,
      _meta: {
        timestamp,
      } as Meta,
    };
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: {
      value: Value;
      _meta: Meta;
    },
    materializedShape?: MaterializedLiveType<
      LiveType<
        Value,
        Meta,
        Value | Partial<Value>,
        { value: Value; _meta: Meta }
      >
    >
  ): [
    MaterializedLiveType<
      LiveType<
        Value,
        Meta,
        Value | Partial<Value>,
        { value: Value; _meta: Meta }
      >
    >,
    { value: Value; _meta: Meta } | null,
  ] {
    if (
      materializedShape &&
      materializedShape._meta.timestamp &&
      encodedMutation._meta.timestamp &&
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
            Meta,
            Value | Partial<Value>,
            { value: Value; _meta: Meta }
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

  /**
   * Returns a new atomic type with a unique constraint.
   */
  unique() {
    return new LiveAtomicType<Value, undefined, Meta>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      true,
      undefined,
      this.foreignReference,
      this.isPrimary
    );
  }

  /**
   * Returns a new atomic type with an index.
   */
  index() {
    return new LiveAtomicType<Value, undefined, Meta>(
      this.storageType,
      this.convertFunc,
      true,
      this.isUnique,
      undefined,
      this.foreignReference,
      this.isPrimary
    );
  }

  /**
   * Returns a new atomic type with a default value.
   */
  default(value: Value) {
    return new LiveAtomicType<Value, Value, Meta>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      this.isUnique,
      value,
      this.foreignReference,
      this.isPrimary
    );
  }

  /**
   * Returns a new atomic type marked as primary key.
   */
  primary() {
    return new LiveAtomicType<Value, undefined, Meta>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      this.isUnique,
      undefined,
      this.foreignReference,
      true
    );
  }

  /**
   * Returns a nullable version of this type.
   * If no default value was set, defaults to null.
   */
  nullable(): NullableLiveType<
    LiveAtomicType<Value, DefaultValue extends undefined ? null : DefaultValue, Meta>
  > {
    // If no default was set, create a new inner with null as default
    if (this.defaultValue === undefined) {
      const innerWithNullDefault = new LiveAtomicType<Value, null, Meta>(
        this.storageType,
        this.convertFunc,
        this.isIndex,
        this.isUnique,
        null,
        this.foreignReference,
        this.isPrimary
      );
      return new NullableLiveType(innerWithNullDefault) as NullableLiveType<
        LiveAtomicType<Value, DefaultValue extends undefined ? null : DefaultValue, Meta>
      >;
    }
    return new NullableLiveType(this) as NullableLiveType<
      LiveAtomicType<Value, DefaultValue extends undefined ? null : DefaultValue, Meta>
    >;
  }

  /**
   * Returns a new atomic type with custom metadata type for advanced sync strategies.
   *
   * @example
   * ```ts
   * type VectorClockMeta = AtomicMeta & { vectorClock: Record<string, number> };
   * const content = string().withMeta<VectorClockMeta>();
   * ```
   */
  withMeta<TMeta extends AtomicMeta>(): LiveAtomicType<
    Value,
    DefaultValue,
    TMeta
  > {
    return new LiveAtomicType<Value, DefaultValue, TMeta>(
      this.storageType,
      this.convertFunc,
      this.isIndex,
      this.isUnique,
      this.defaultValue,
      this.foreignReference,
      this.isPrimary
    );
  }
}

/**
 * Live number type.
 */
export class LiveNumber extends LiveAtomicType<number> {
  private constructor() {
    super("integer", (value) => Number(value));
  }

  static create() {
    return new LiveNumber();
  }
}

export const number = LiveNumber.create;

/**
 * Live string type.
 */
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
// TODO add enum support

/**
 * Live boolean type.
 */
export class LiveBoolean extends LiveAtomicType<boolean> {
  private constructor() {
    super("boolean", (value) => {
      if (typeof value === "string") {
        return value.toLowerCase() === "true";
      }

      return !!value;
    });
  }

  static create() {
    return new LiveBoolean();
  }
}

export const boolean = LiveBoolean.create;

/**
 * Live timestamp type (maps to Date).
 */
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
