export type DeepSubscribable<T> = {
  [K in keyof T]: DeepSubscribable<T[K]>;
} & {
  get: () => T;
  subscribe: (callback: (value: T) => void) => () => void;
};
