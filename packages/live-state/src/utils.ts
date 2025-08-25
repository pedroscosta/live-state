import { sha256 } from "crypto-hash";

export type Simplify<T> =
  T extends Record<string, any>
    ? {
        [K in keyof T]: Simplify<T[K]>;
      }
    : T;

export const hash = (value: any) => {
  return sha256(JSON.stringify(value));
};
