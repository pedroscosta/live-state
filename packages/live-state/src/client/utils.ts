import type { LiveObjectAny, WhereClause } from "../schema";

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
          typeof anyTgt[segString] === "object" ? anyTgt[segString] : () => {},
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

export const applyWhere = <T extends object>(
  obj: T,
  where: WhereClause<LiveObjectAny>
): boolean => {
  return Object.entries(where).every(([k, v]) => {
    if (typeof v === "object" && v !== null) {
      // Handle $eq operator
      if (v.$eq !== undefined) return obj[k as keyof T] === v.$eq;

      // Handle nested objects
      if (!obj[k as keyof T] || typeof obj[k as keyof T] !== "object")
        return false;

      return applyWhere(obj[k as keyof T] as object, v);
    }

    return obj[k as keyof T] === v;
  });
};

export const filterWithLimit = <T>(
  items: T[],
  predicate: (item: T, index: number) => boolean,
  limit?: number
): T[] => {
  const result: T[] = [];
  let processedCount = 0;

  for (
    let i = 0;
    i < items.length && (limit === undefined || processedCount < limit);
    i++
  ) {
    if (predicate(items[i], i)) {
      result.push(items[i]);
      processedCount++;
    }
  }

  return result;
};
