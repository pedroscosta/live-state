import { ZodType } from "zod";
import {
  AnyShape,
  InferOutput,
  InferShape,
  ShapeNamesFromRecord,
  ShapeRecord,
} from "../shape";

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
  return Query.create<ShapeName, InferOutput<Shapes[ShapeName]>>(shapeName);
};

export type QueryFactory<
  Shapes extends ShapeRecord,
  ShapeName extends ShapeNamesFromRecord<Shapes>,
> = <O extends Query<ShapeName, never, InferOutput<Shapes[ShapeName]>>>(
  shapeName: ShapeName
) => O;

export type MutationType = "update" | "insert" | "remove";
export abstract class Mutation<
  I extends AnyShape | never,
  O extends any,
  TMutType extends MutationType,
> {
  _type: "mutation" = "mutation";
  _mutationType: TMutType;
  _input: I;
  _output!: O;

  constructor(mutationType: TMutType, input: I) {
    this._input = input;
    this._mutationType = mutationType;
  }

  public input<NewInput extends AnyShape>(newInput: NewInput) {
    this._input = newInput as any;
    return this as any as Mutation<NewInput, O, TMutType>;
  }

  // To-do: mutate should be a reducer (take the current state and the mutation and return the new state)
  public abstract mutate(input: InferShape<I>): void;
}

export type AnyMutation = Mutation<AnyShape, any, any>;

export type MutationRecord = Record<string, AnyMutation>;

export class UpdateMutation<
  I extends AnyShape | never,
  O extends any,
> extends Mutation<I, O, "update"> {
  public constructor(input?: I) {
    super("update", input ?? (null as never));
  }

  public mutate(input: InferShape<I>) {
    console.log("Updating", input);
  }

  public static createUpdate() {
    return new UpdateMutation<never, any>();
  }
}

export const update = UpdateMutation.createUpdate;

export type InjectedMutation<
  TMutation extends Mutation<any, any, any>,
  TShape extends AnyShape,
> =
  TMutation extends Mutation<infer I, any, infer MType>
    ? [I] extends [never]
      ? Mutation<TShape, InferOutput<TShape>, MType>
      : Mutation<I, InferOutput<TShape>, MType>
    : never;

export type InjectedMutationRecord<
  TRecord extends MutationRecord,
  TShape extends AnyShape,
> = {
  [K in keyof TRecord]: InjectedMutation<TRecord[K], TShape>;
};
