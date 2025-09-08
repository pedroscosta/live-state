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
  where: WhereClause<LiveObjectAny>,
  not = false
): boolean => {
  return Object.entries(where).every(([k, v]) => {
    if (k === "$and")
      return v.every((w: WhereClause<LiveObjectAny>) =>
        applyWhere(obj, w, not)
      );
    if (k === "$or")
      return v.some((w: WhereClause<LiveObjectAny>) => applyWhere(obj, w, not));

    const comparisonValue = v?.$eq !== undefined ? v?.$eq : v;

    if (typeof v === "object" && v !== null && v?.$eq === undefined) {
      // Handle $in operator
      if (v.$in !== undefined)
        return not
          ? !v.$in.includes(obj[k as keyof T])
          : v.$in.includes(obj[k as keyof T]);

      // Handle $not operator
      if (v.$not !== undefined && !not)
        return applyWhere(obj, { [k]: v.$not }, true);

      // Handle $gt operator
      if (v.$gt !== undefined)
        return not ? obj[k as keyof T] <= v.$gt : obj[k as keyof T] > v.$gt;

      // Handle $gte operator
      if (v.$gte !== undefined)
        return not ? obj[k as keyof T] < v.$gte : obj[k as keyof T] >= v.$gte;

      // Handle $lt operator
      if (v.$lt !== undefined)
        return not ? obj[k as keyof T] >= v.$lt : obj[k as keyof T] < v.$lt;

      // Handle $lte operator
      if (v.$lte !== undefined)
        return not ? obj[k as keyof T] > v.$lte : obj[k as keyof T] <= v.$lte;

      // Handle nested objects
      if (!obj[k as keyof T] || typeof obj[k as keyof T] !== "object")
        return false;

      return applyWhere(obj[k as keyof T] as object, v);
    }

    return not
      ? obj[k as keyof T] !== comparisonValue
      : obj[k as keyof T] === comparisonValue;
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
