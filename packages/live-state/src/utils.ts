export type Simplify<T> =
  T extends Record<string, any>
    ? {
        [K in keyof T]: Simplify<T[K]>;
      }
    : T;
