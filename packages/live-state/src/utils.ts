import { xxHash32 } from "js-xxhash";
import type {
  IncludeClause,
  LiveObjectAny,
  Schema,
  WhereClause,
} from "./schema";

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

/**
 * Extracts include clauses from a where clause by finding all relation references
 */
export const extractIncludeFromWhere = (
  where: WhereClause<any>,
  resource: string,
  schema: Schema<any>
): IncludeClause<any> => {
  const include: any = {};

  const resourceSchema = schema[resource];

  if (!resourceSchema) {
    return include;
  }

  const processWhere = (w: WhereClause<any>) => {
    if (w.$and) {
      w.$and.forEach(processWhere);
    } else if (w.$or) {
      w.$or.forEach(processWhere);
    } else {
      Object.entries(w).forEach(([key, value]) => {
        // Check if this key is a relation
        if (resourceSchema.relations?.[key]) {
          include[key] = true;

          // If the value is a nested where clause, recursively extract includes
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            const nestedInclude = extractIncludeFromWhere(
              value as WhereClause<any>,
              resourceSchema.relations[key].entity.name,
              schema
            );

            // Only set nested include if it has any relations
            if (Object.keys(nestedInclude).length > 0) {
              include[key] = nestedInclude;
            }
          }
        }
      });
    }
  };

  processWhere(where);
  return include as IncludeClause<any>;
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
      const fieldValue = obj[k as keyof T];

      if (
        !fieldValue ||
        (typeof fieldValue !== "object" && !Array.isArray(fieldValue))
      )
        return false;

      // If the field is an array, check if any element matches the where clause
      if (Array.isArray(fieldValue)) {
        return not
          ? !fieldValue.some((item) => applyWhere(item as object, v, false))
          : fieldValue.some((item) => applyWhere(item as object, v, false));
      }

      return applyWhere(fieldValue as object, v, not);
    }

    return not
      ? obj[k as keyof T] !== comparisonValue
      : obj[k as keyof T] === comparisonValue;
  });
};
