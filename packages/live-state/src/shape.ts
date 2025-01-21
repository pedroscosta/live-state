import { z, ZodType, ZodTypeAny } from "zod";

export type Shape<T extends ZodType> = T;

export type AnyShape = Shape<ZodTypeAny>;

export type ShapeRecord = Record<string, AnyShape>;

export type ShapeNamesFromRecord<T extends ShapeRecord> = keyof T extends string
  ? keyof T
  : never;

export type InferShape<T extends AnyShape> = z.infer<T>;

export const number = () =>
  z.object({
    value: z.number(),
    _metadata: z.object({
      timestamp: z.string(),
    }),
  });

export type LiveNumber = z.infer<ReturnType<typeof number>>;

export const string = () =>
  z.object({
    value: z.string(),
    _metadata: z.object({
      timestamp: z.string(),
    }),
  });

export type LiveString = z.infer<ReturnType<typeof string>>;

export const boolean = () =>
  z.object({
    value: z.boolean(),
    _metadata: z.object({
      timestamp: z.string(),
    }),
  });

export type LiveBoolean = z.infer<ReturnType<typeof boolean>>;

export type AtomicType =
  | ReturnType<typeof boolean>
  | ReturnType<typeof number>
  | ReturnType<typeof string>;

export const object = (obj: Record<string, AtomicType>) => z.object(obj);

export type LiveObject<T extends Record<string, AtomicType>> = z.infer<
  ReturnType<typeof object>
>;

export const array = <T extends ZodTypeAny>(arr: T) => z.array(arr);

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
