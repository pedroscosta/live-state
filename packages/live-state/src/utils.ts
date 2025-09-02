import { xxHash32 } from "js-xxhash";

export type Simplify<T> =
  T extends Record<string, any>
    ? {
        [K in keyof T]: Simplify<T[K]>;
      }
    : T;

export const hash = (value: any) => {
  return xxHash32(JSON.stringify(value)).toString(32);
};
