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
