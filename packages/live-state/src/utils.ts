import { xxHash32 } from "js-xxhash";

export type Simplify<T> =
  T extends Record<string, unknown>
    ? {
        [K in keyof T]: Simplify<T[K]>;
      }
    : T extends Array<infer U>
      ? Array<Simplify<U>>
      : T;

export const hash = (value: unknown) => {
  return xxHash32(JSON.stringify(value)).toString(32);
};
