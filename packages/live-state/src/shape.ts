import { z, ZodType, ZodTypeAny } from "zod";

export type Shape<T extends ZodType = ZodTypeAny> = T;

export type Shapes<N extends string = string> = Record<N, Shape>;

export type ShapeNames<T extends Shapes> = keyof T;

export type InferShape<T extends Shape> = z.infer<T>;

export const number = z.object({
  value: z.number(),
  _metadata: z.object({
    timestamp: z.string(),
  }),
});

export type LiveNumber = z.infer<typeof number>;

// type LiveTypeDef = {};

// abstract class LiveType<
//   Input = any,
//   Def extends LiveTypeDef = LiveTypeDef,
//   Output = Input,
// > {
//   readonly _type!: Output;
//   readonly _def: Def;
//   readonly _input!: Input;

//   abstract _materialize(input: Input): Output;

//   constructor(def: Def) {
//     this._def = def;
//   }
// }

// type LiveNumberDef = LiveTypeDef & {};

// class LiveNumber extends LiveType<number, LiveNumberDef, number> {
//   _materialize(input: number) {
//     return input;
//   }
// }
