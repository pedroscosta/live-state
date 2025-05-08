import { MaterializedLiveType } from ".";
import { LiveType, LiveTypeAny, LiveTypeMeta, MutationType } from "./live-type";

class OptionalLiveType<T extends LiveTypeAny> extends LiveType<
  T["_value"] | undefined,
  T["_meta"],
  T["_encodeInput"],
  T["_decodeInput"]
> {
  encodeMutation(
    mutationType: MutationType,
    input: T["_value"] | undefined,
    timestamp: string
  ): string {
    throw new Error("Method not implemented.");
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
> extends LiveType<Value, Meta, EncodeInput> {
  constructor() {
    super();
    this.optional = this.optional.bind(this);
  }

  optional(): OptionalLiveType<this> {
    return new OptionalLiveType<this>();
  }
}

export class LiveNumber extends LiveAtomicType<number> {
  encodeMutation(
    mutationType: MutationType,
    input: Partial<number>,
    timestamp: string
  ) {
    return {
      value: input,
      _meta: {
        timestamp,
      },
    };
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: { value: number; _meta: { timestamp: string } },
    materializedShape?: MaterializedLiveType<LiveNumber>
  ): [
    MaterializedLiveType<LiveNumber>,
    { value: number; _meta: { timestamp: string } } | null,
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
        value: Number(encodedMutation.value),
        _meta: encodedMutation._meta,
      },
      encodedMutation,
    ];
  }

  static create() {
    return new LiveNumber();
  }
}

export const number = LiveNumber.create;

export class LiveString extends LiveAtomicType<string> {
  encodeMutation(
    mutationType: MutationType,
    input: Partial<string>,
    timestamp: string
  ) {
    return {
      value: input,
      _meta: {
        timestamp,
      },
    };
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: { value: string; _meta: { timestamp: string } },
    materializedShape?: MaterializedLiveType<LiveString>
  ): [
    MaterializedLiveType<LiveString>,
    { value: string; _meta: { timestamp: string } } | null,
  ] {
    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(
        encodedMutation._meta.timestamp
      ) >= 0
    )
      return [materializedShape, null];

    return [encodedMutation, encodedMutation];
  }

  static create() {
    return new LiveString();
  }
}

export const string = LiveString.create;
