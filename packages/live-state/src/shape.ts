type LiveTypeMeta = {};

abstract class LiveType<
  Input = any,
  Meta extends LiveTypeMeta = LiveTypeMeta,
  Output = Input,
> {
  readonly _type!: Output;
  readonly _meta!: Meta;
  readonly _input!: Input;

  abstract encode(mutation: string, input: Input, timestamp: string): string;

  abstract decode(
    encodedMutation: string,
    materializedShape?: MaterializedShape<LiveType<Input, Meta, Output>>
  ): MaterializedShape<LiveType<Input, Meta, Output>>;
}

type LiveAtomicTypeMeta = {
  timestamp: string;
} & LiveTypeMeta;

abstract class LiveAtomicType<
  Input = any,
  Meta extends LiveAtomicTypeMeta = LiveAtomicTypeMeta,
  Output = Input,
> extends LiveType<Input, Meta, Output> {}

export class LiveNumber extends LiveAtomicType<number> {
  encode(mutationName: string, input: number, timestamp: string) {
    return `${mutationName};${input};${timestamp}`;
  }

  decode(
    encodedMutation: string,
    materializedShape?: MaterializedShape<LiveNumber>
  ): MaterializedShape<LiveNumber> {
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

export type LiveTypeAny = LiveType<any>;

export type Shape<T extends LiveTypeAny> = T;

export type AnyShape = Shape<LiveTypeAny>;

export type ShapeRecord = Record<string, AnyShape>;

export type ShapeNamesFromRecord<T extends ShapeRecord> = keyof T extends string
  ? keyof T
  : never;

export type InferShape<T extends AnyShape> = T["_input"];

export type InferOutput<T extends AnyShape> = T["_type"];

export type MaterializedShape<T extends AnyShape> = {
  value: T["_type"];
  _meta: T["_meta"];
};
