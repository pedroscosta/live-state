type LiveTypeMeta = {};

export type MutationType = "insert" | "update" | "delete";

abstract class LiveType<
  Input = any,
  Meta extends LiveTypeMeta = LiveTypeMeta,
  Output = Input,
> {
  readonly _type!: Output;
  readonly _meta!: Meta;
  readonly _input!: Input;

  abstract encode(
    mutationType: MutationType,
    input: Input,
    timestamp: string
  ): string;

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

export class LiveTable<
  TSchema extends Record<string, LiveTypeAny>,
> extends LiveType<TSchema> {
  encode(
    mutationType: MutationType,
    input: TSchema,
    timestamp: string
  ): string {
    throw new Error("Method not implemented.");
  }

  decode(
    encodedMutation: string,
    materializedShape?:
      | MaterializedShape<LiveType<TSchema, LiveTypeMeta, TSchema>>
      | undefined
  ): MaterializedShape<LiveType<TSchema, LiveTypeMeta, TSchema>> {
    throw new Error("Method not implemented.");
  }

  static create<TSchema extends Record<string, LiveTypeAny>>(schema: TSchema) {
    return new LiveTable<TSchema>();
  }
}

export const table = LiveTable.create;

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
