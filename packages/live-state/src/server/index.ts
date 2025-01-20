import ws from "ws";
import { z, ZodType, ZodTypeAny } from "zod";
import { clientMessageSchema, ServerMessage } from "../core/internals";
import { InferShape, number, Shape, Shapes } from "../shape";

// export * from "./procedures";
export * from "./web-socket";

type Subscription = {
  connection: ws.WebSocket;
  filters?: Record<string, any>;
};

export type Query<
  S extends string = string,
  Input extends ZodType = ZodTypeAny,
  Output = any,
> = {
  shape: S;
  input: Input;
  output: Output;
};

export type Mutation<Input = any> = {
  input: Input;
};

export type LiveStateOptions<ShapeNames extends string = string> = {
  shapes: Shapes<ShapeNames>;
  procedures: Record<string, Query | Mutation>;
};

export const createLiveStateRouter = <ShapeNames extends string = string>(
  constructor: (
    query: <s extends ShapeNames>(shapeName: s) => Query<s>
  ) => LiveStateOptions<ShapeNames>
) => {
  const createQuery = <s extends ShapeNames>(shapeName: s) => ({
    shape: shapeName,
    input: undefined as any,
    output: undefined as any,
  });

  const opts = constructor(createQuery);
  const shapes = opts.shapes;
  const procedures = opts.procedures;

  const connections = new Set<ws.WebSocket>();
  const subscriptions: Record<ShapeNames, Subscription[]> = {} as Record<
    ShapeNames,
    Subscription[]
  >;

  const sendMutations = <T extends Shape>(
    shape: ShapeNames,
    mutations: Partial<InferShape<T>>[],
    ignoreConnection?: ws.WebSocket
  ) => {
    subscriptions[shape]?.forEach(({ connection, filters }) => {
      if (connection === ignoreConnection) return;

      connection.send(
        JSON.stringify({
          type: "MUTATE",
          shape,
          mutations,
        } satisfies ServerMessage)
      );
    });
  };

  const addConnection = (connection: ws.WebSocket) => {
    connections.add(connection);

    connection.on("close", () => {
      console.log("Connection closed");
      connections.delete(connection);
    });

    connection.on("message", (_message) => {
      console.log("Message received from the client:", _message);
      const message = clientMessageSchema.parse(
        JSON.parse(_message.toString())
      );

      const sendResponse = (response: any) => {
        connection.send(JSON.stringify(response));
      };

      if (message.type === "SUBSCRIBE") {
        console.log("Subscribing to", message);
        const { shape: shape_ } = message;

        if (!shapes[shape_ as ShapeNames]) return;

        const shape = shape_ as ShapeNames;

        if (!subscriptions[shape]) {
          subscriptions[shape] = [];
        }

        subscriptions[shape].push({
          connection,
        });
      }

      if (message.type === "MUTATE") {
        console.log("Mutating", message.shape);

        const { shape: shape_, mutations } = message;

        const shapeName = shape_ as ShapeNames;
        const shapeSchema = shapes[shapeName];

        if (!shapeSchema) return;

        const { success, data } = z.array(shapeSchema).safeParse(mutations);

        // TODO: Send response
        if (!success) return;

        sendMutations(shapeName, data, connection);
      }
    });
  };

  return {
    addConnection,
    connections,
    shapes,
    procedures,
  };
};

const test = createLiveStateRouter((query) => ({
  shapes: { counter: number },
  procedures: {
    getCounter: query("counter"),
  },
}));

export type AnyLiveStateRouter = ReturnType<typeof createLiveStateRouter>;
