export type ObservableHandler<T extends object> = {
  get?(target: T, p: string[]): any;
};

export const createObservable = <T extends object>(
  obj: T,
  handler: ObservableHandler<T>,
  parentPath: string[] = []
) => {
  return new Proxy(obj, {
    get: (target, segment) => {
      if (segment === "__isProxy__") return true;

      const handlerResult = handler.get?.(target, [
        ...parentPath,
        segment as string,
      ]);

      if (handlerResult !== undefined) return handlerResult;

      const anyTgt = target as any;
      const segString = segment as string;

      if (!anyTgt[segString]?.__isProxy__) {
        anyTgt[segString] = createObservable(
          typeof anyTgt[segString] === "object"
            ? anyTgt[segString]
            : Object.create(null),
          handler,
          [...parentPath, segment as string]
        );
      }

      return anyTgt[segString];
    },
  });
};

export type Observable<T> = {
  [K in keyof T]: Observable<T[K]>;
} & {
  get: () => T;
  subscribe: (callback: (value: T) => void) => () => void;
};

// export type Observable<T> = {
//   get: () => T;
// } & {
//   [K in keyof T]: {
//     get: () => T[K];
//   } & (Exclude<T[K], undefined> extends Array<infer U>
//     ? Observable<T[K]>
//     : Exclude<T[K], undefined> extends Record<string, any>
//       ? Observable<T[K]>
//       : {});
// };
