import { Storage } from "./interface";
import { SQLStorage } from "./sql-storage";

// type SimpleKyselyQueryInterface = {
//   where: (
//     column: string,
//     operator: string,
//     value: any
//   ) => SimpleKyselyQueryInterface;
//   leftJoin: (
//     table: string,
//     field1: string,
//     field2: string
//   ) => SimpleKyselyQueryInterface;
//   executeTakeFirst: () => Promise<Record<string, any>>;
//   execute: () => Promise<Record<string, any>[]>;
//   select: (eb: (eb: any) => any) => SimpleKyselyQueryInterface;
// };

export { Storage, SQLStorage };
