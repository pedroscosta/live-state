export type ObservableHandler<T extends object> = {
  get?(target: T, p: string[]): any;
  apply?(target: T, p: string[], argumentsList: any[]): any;
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
            : (() => {}),
          handler,
          [...parentPath, segment as string]
        );
      }

      return anyTgt[segString];
    },
    apply: (target, _thisArg, argumentsList) => {
      return handler.apply?.(target, parentPath, argumentsList);
    },
  });
};

export const applyWhere = <T extends object>(obj: T, where: any) => {
  return Object.entries(where).every(([k, v]) => {
    return obj[k as keyof T] === v;
  });
};
