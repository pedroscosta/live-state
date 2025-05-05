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
    if (mutationType !== "set")
      throw new Error("Mutation type not implemented.");

    return `${input};${timestamp}`;
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: string,
    materializedShape?: MaterializedLiveType<LiveNumber>
  ): [MaterializedLiveType<LiveNumber>, string | null] {
    const [value, ts] = encodedMutation.split(";");

    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(ts) >= 0
    )
      return [materializedShape, null];

    return [
      { value: Number(value), _meta: { timestamp: ts } },
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
    if (mutationType !== "set")
      throw new Error("Mutation type not implemented.");

    return `${input};${timestamp}`;
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: string,
    materializedShape?: MaterializedLiveType<LiveString>
  ): [MaterializedLiveType<LiveString>, string | null] {
    const [value, ts] = encodedMutation.split(";");

    if (
      materializedShape &&
      materializedShape._meta.timestamp.localeCompare(ts) >= 0
    )
      return [materializedShape, null];

    return [
      {
        value: value,
        _meta: {
          timestamp: ts,
        },
      },
      encodedMutation,
    ];
  }

  static create() {
    return new LiveString();
  }
}

export const string = LiveString.create;
