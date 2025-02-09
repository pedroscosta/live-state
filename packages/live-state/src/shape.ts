type LiveTypeMeta = {};

abstract class LiveType<
  Input = any,
  Meta extends LiveTypeMeta = LiveTypeMeta,
  Output = Input,
> {
  readonly _type!: Output;
  readonly _meta!: Meta;
  readonly _input!: Input;

  abstract encode(name: string, input: Input, timestamp: string): string;
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
  encode(name: string, input: number, timestamp: string) {
    return `${name};${input};${timestamp}`;
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
