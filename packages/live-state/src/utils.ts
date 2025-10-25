import { xxHash32 } from "js-xxhash";
import type { LiveObjectAny, WhereClause } from "./schema";

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

export const applyWhere = <T extends object>(
  obj: T,
  where: WhereClause<LiveObjectAny>,
  not = false
): boolean => {
  return Object.entries(where).every(([k, v]) => {
    console.log("k", k, "v", v);
    if (k === "$and")
      return v.every((w: WhereClause<LiveObjectAny>) =>
        applyWhere(obj, w, not)
      );
    if (k === "$or")
      return v.some((w: WhereClause<LiveObjectAny>) => applyWhere(obj, w, not));

    const comparisonValue = v?.$eq !== undefined ? v?.$eq : v;

    if (typeof v === "object" && v !== null && v?.$eq === undefined) {
      // Handle $in operator
      if (v.$in !== undefined) {
        const value = obj[k as keyof T];
        if (value === undefined) {
          return false;
        }
        return not ? !v.$in.includes(value) : v.$in.includes(value);
      }

      // Handle $not operator
      if (v.$not !== undefined && !not)
        return applyWhere(obj, { [k]: v.$not }, true);

      // Handle $gt operator
      if (v.$gt !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value <= v.$gt : value > v.$gt;
      }

      // Handle $gte operator
      if (v.$gte !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value < v.$gte : value >= v.$gte;
      }

      // Handle $lt operator
      if (v.$lt !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value >= v.$lt : value < v.$lt;
      }

      // Handle $lte operator
      if (v.$lte !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value > v.$lte : value <= v.$lte;
      }

      // Handle nested objects
      if (!obj[k as keyof T] || typeof obj[k as keyof T] !== "object")
        return false;

      return applyWhere(obj[k as keyof T] as object, v, not);
    }

    return not
      ? obj[k as keyof T] !== comparisonValue
      : obj[k as keyof T] === comparisonValue;
  });
};
