import { AnyQuery } from "./server";

type RouterDef<
  ShapeNames extends string,
  Procedures extends Record<string, AnyQuery>,
> = {
  _def: {
    shapeNames: ShapeNames[];
    procedures: Procedures;
  };
};

export type ShapeNamesFromShapes<TShapes extends Record<string, string>> =
  keyof TShapes extends string ? keyof TShapes : never;

type Shapes = Record<string, string>;

type QueryFactory<
  TShapes extends Shapes,
  Q extends AnyQuery,
  S extends ShapeNamesFromShapes<TShapes>,
> = (shapeName: S) => Q;

const defRouter = <
  TShapes extends Shapes,
  Procedures extends Record<string, AnyQuery>,
>(opts: {
  shapes: TShapes;
  procedures: Procedures;
}): RouterDef<ShapeNamesFromShapes<TShapes>, Procedures> => {
  const createQuery: QueryFactory<
    TShapes,
    AnyQuery,
    ShapeNamesFromShapes<TShapes>
  > = (shapeName) => ({
    _type: "query",
    shape: shapeName,
    input: undefined as any,
    output: undefined as any,
  });

  return {
    _def: {
      shapeNames: Object.keys(opts.shapes) as ShapeNamesFromShapes<TShapes>[],
      procedures: opts.procedures,
    },
  };
};

const test = defRouter((query) => ({
  shapes: {
    counter: "number",
    issues: "array",
  },
  procedures: {
    getCounter: query("a"),
    // getIssues: "query",
  },
}));

type a = typeof test._def.procedures;
