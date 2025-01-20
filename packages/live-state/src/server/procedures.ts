import { z, ZodType } from "zod";
import { ShapeNamesFromRecord, ShapeRecord } from "../shape";

export class Query<T extends string, I extends ZodType | never, O extends any> {
  _type: "query" = "query";
  _input: I;
  _output!: O;
  _shape: T;

  private constructor(shape: T, input: I) {
    this._input = input;
    this._shape = shape;
  }

  public input<NewInput extends ZodType>(newInput: NewInput) {
    return new Query<T, NewInput, O>(this._shape, newInput);
  }

  static create<T extends string, O extends any>(shape: T) {
    return new Query<T, never, O>(shape, null as never);
  }
}

export const queryFactory = <
  Shapes extends ShapeRecord,
  ShapeName extends ShapeNamesFromRecord<Shapes>,
>(
  shapeName: ShapeName
) => {
  return Query.create<ShapeName, z.output<Shapes[ShapeName]>>(shapeName);
};

export type QueryFactory<
  Shapes extends ShapeRecord,
  ShapeName extends ShapeNamesFromRecord<Shapes>,
> = <O extends Query<ShapeName, never, z.output<Shapes[ShapeName]>>>(
  shapeName: ShapeName
) => O;
