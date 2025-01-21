// import WebSocket from "ws";
// import { z } from "zod";
// import { AnyMutation, AnyQuery, AnyRouter, createRouter } from "../server";
// import { number } from "../shape";
// import { createObservable } from "./observable";

// // TODO: Add type for materialized query
// type MapQuery<TQuery extends AnyQuery> = TQuery["_input"] extends never
//   ? () => void
//   : (input: z.input<TQuery["_input"]>) => void;

// type MapMutation<TMutation extends AnyMutation> = (
//   input: z.input<TMutation["input"]>
// ) => void;

// type _ProcedureMap<TRouter extends AnyRouter> = {
//   [K in keyof TRouter["_procedures"]]: TRouter["_procedures"][K]["_type"] extends "query"
//     ? MapQuery<TRouter["_procedures"][K]>
//     : MapMutation<TRouter["_procedures"][K]>;
// };

// type ProcedureMap<TRouter extends AnyRouter> = {
//   query: {
//     [K in keyof TRouter["_procedures"]]: TRouter["_procedures"][K]["_type"] extends "query"
//       ? MapQuery<TRouter["_procedures"][K]>
//       : never;
//   };
//   mutation: {
//     [K in keyof TRouter["_procedures"]]: TRouter["_procedures"][K]["_type"] extends "mutation"
//       ? MapMutation<TRouter["_procedures"][K]>
//       : never;
//   };
// };

// export type ClientOptions = {
//   url: string;
// };

// export class LiveStateClient<TRouter extends AnyRouter> {
//   private readonly _socket: WebSocket;
//   readonly _router!: TRouter;

//   private constructor(opts: ClientOptions) {
//     this._socket = new WebSocket(opts.url);
//   }

//   static create<Router extends AnyRouter>(opts: ClientOptions) {
//     const ogClient = new LiveStateClient<Router>(opts);

//     return createObservable(ogClient, {
//       get: (obj, path) => {
//         if (path.length < 2) return;
//         if (path.length > 2)
//           throw new SyntaxError(
//             "Trying to access a property on the client that does't exist"
//           );

//         const [op, id] = path;

//         return null;
//       },
//     }) as LiveStateClient<Router> & ProcedureMap<Router>;
//   }
// }

// export const createClient = LiveStateClient.create;

// const testRouter = createRouter({
//   counter: number(),
// }).procedures((query, mutation) => ({
//   getCounter: query("counter").input(z.number()),
//   getCounter2: query("counter"),
//   incrementCounter: mutation(z.number().optional(), (amt) => {
//     console.log("Incrementing counter", amt);
//   }),
//   decrementCounter: mutation(z.number().optional(), (input) => {
//     console.log("Decrementing counter", input);
//   }),
// }));

// type TestRouter = typeof testRouter;

// const testClient = createClient<TestRouter>({
//   url: "ws://localhost:5001/ws",
// });

// type a = (typeof testClient)["query"]["getCounter"];
// type b = (typeof testClient)["query"]["getCounter2"];

// testClient.query.getCounter2();

// // testClient.query.getCounter();

export const _keep = true;
