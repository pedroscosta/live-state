import ws from "ws";
import { z, ZodType } from "zod";
import { ShapeNamesFromRecord, ShapeRecord } from "../shape";
import { Query, queryFactory, QueryFactory } from "./procedures";

// export * from "./procedures";
export * from "./web-socket";

type Subscription = {
  connection: ws.WebSocket;
  filters?: Record<string, any>;
};

// export type Query<
//   S extends string,
//   Input extends ZodType | never,
//   Output = any,
// > = {
//   _type: "query";
//   shape: S;
//   input: Input;
//   output: Output;
// };

export type Mutation<Input> = {
  _type: "mutation";
  input: Input;
};

export type AnyQuery = Query<any, any, any>;
export type AnyMutation = Mutation<any>;
export type AnyProcedure = AnyMutation | AnyQuery;

export type ProcedureRecord = Record<string, AnyProcedure>;

// export type QueryFactory<
//   Shapes extends ShapeRecord,
//   ShapeName extends ShapeNamesFromRecord<Shapes>,
// > = <
//   Input extends ZodType,
//   Output extends Query<ShapeName, Input, z.output<Shapes[ShapeName]>>,
// >(
//   shapeName: ShapeName,
//   input?: Input
// ) => Output;

export type MutationFactory = <
  Input extends ZodType,
  Output extends Mutation<Input>,
>(
  input: Input,
  mutation: (input: z.output<Input>) => void
) => Output;

export class Router<
  Shapes extends ShapeRecord,
  ShapeNames extends ShapeNamesFromRecord<Shapes>,
  Procedures extends ProcedureRecord,
> {
  /**
   * @internal
   */
  readonly _def: {
    shapeNames: ShapeNames[];
  };
  /**
   * @internal
   */
  readonly _shapes: Shapes;
  /**
   * @internal
   */
  readonly _procedures: Procedures;

  private constructor(shapes: Shapes, procedures?: Procedures) {
    this._def = {
      shapeNames: Object.keys(shapes) as ShapeNames[],
    };
    this._shapes = shapes;
    this._procedures = procedures ?? ({} as Procedures);
  }

  public procedures<TProcedures extends ProcedureRecord>(
    procedureFactory: (
      query: QueryFactory<Shapes, ShapeNames>,
      mutation: MutationFactory
    ) => TProcedures
  ) {
    const mutationFactory: MutationFactory = <
      I extends ZodType,
      O extends Mutation<I>,
    >(
      input: I,
      mutation: (input: I) => void
    ) => {
      return {
        _type: "mutation",
        input: input,
      } as O;
    };

    return new Router(
      this._shapes,
      procedureFactory(
        queryFactory as QueryFactory<Shapes, ShapeNames>,
        mutationFactory
      )
    );
  }

  static create<TShapes extends ShapeRecord>(shapes: TShapes) {
    return new Router(shapes);
  }
}

export const createRouter = Router.create;

export type AnyRouter = Router<Record<string, any>, any, any>;

// TODO: Port this back to the server

// export const createLiveStateRouter = <ShapeNames extends string>(
//   constructor: (
//     query: <S extends ShapeNames, I extends ZodType>(shapeName: S) => AnyQuery
//   ) => LiveStateOptions<ShapeNames, ProcedureRecord>
// ) => {
//   const createQuery = <s extends ShapeNames, i extends ZodType>(shapeName: s) =>
//     ({
//       shape: shapeName,
//       input: undefined as any,
//       output: undefined as any,
//     }) as Query<s, i>;

//   const opts = constructor(createQuery);
//   const shapes = opts.shapes;
//   const procedures = opts.procedures;

//   const connections = new Set<ws.WebSocket>();
//   const subscriptions: Record<ShapeNames, Subscription[]> = {} as Record<
//     ShapeNames,
//     Subscription[]
//   >;

//   const sendMutations = <T extends Shape>(
//     shape: ShapeNames,
//     mutations: Partial<InferShape<T>>[],
//     ignoreConnection?: ws.WebSocket
//   ) => {
//     subscriptions[shape]?.forEach(({ connection, filters }) => {
//       if (connection === ignoreConnection) return;

//       connection.send(
//         JSON.stringify({
//           type: "MUTATE",
//           shape,
//           mutations,
//         } satisfies ServerMessage)
//       );
//     });
//   };

//   const addConnection = (connection: ws.WebSocket) => {
//     connections.add(connection);

//     connection.on("close", () => {
//       console.log("Connection closed");
//       connections.delete(connection);
//     });

//     connection.on("message", (_message) => {
//       console.log("Message received from the client:", _message);
//       const message = clientMessageSchema.parse(
//         JSON.parse(_message.toString())
//       );

//       const sendResponse = (response: any) => {
//         connection.send(JSON.stringify(response));
//       };

//       if (message.type === "SUBSCRIBE") {
//         console.log("Subscribing to", message);
//         const { shape: shape_ } = message;

//         if (!shapes[shape_ as ShapeNames]) return;

//         const shape = shape_ as ShapeNames;

//         if (!subscriptions[shape]) {
//           subscriptions[shape] = [];
//         }

//         subscriptions[shape].push({
//           connection,
//         });
//       }

//       if (message.type === "MUTATE") {
//         console.log("Mutating", message.shape);

//         const { shape: shape_, mutations } = message;

//         const shapeName = shape_ as ShapeNames;
//         const shapeSchema = shapes[shapeName];

//         if (!shapeSchema) return;

//         const { success, data } = z.array(shapeSchema).safeParse(mutations);

//         // TODO: Send response
//         if (!success) return;

//         sendMutations(shapeName, data, connection);
//       }
//     });
//   };

//   return {
//     addConnection,
//     connections,
//     shapes,
//     procedures,
//   };
// };

// export type AnyLiveStateRouter = ReturnType<typeof createLiveStateRouter>;

console.log("Hello");
