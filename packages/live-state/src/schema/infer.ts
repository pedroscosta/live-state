import type { LiveAtomicType, NullableLiveType } from "./atomic";
import type { IncludeClause, SubQueryInclude } from "./clauses";
import type {
  LiveCollectionAny,
  LiveCollectionMutationInput,
} from "./collection";
import type { RelationAny } from "./relations";
import type { InferLiveType, LiveTypeAny, MaterializedLiveType } from "./types";

/**
 * Infers the TypeScript type of a collection without relations.
 */
export type InferLiveCollectionWithoutRelations<T extends LiveCollectionAny> = {
  [K in keyof T["fields"]]: InferLiveType<T["fields"][K]>;
};

/**
 * Infers relational columns (FK fields) from relations.
 * Note: We use `string` directly since InferIndex currently returns string
 * and RelationAny uses an interface that doesn't extend LiveTypeAny.
 */
type InferRelationalColumns<T extends Record<string, RelationAny>> = {
  [K in keyof T as T[K]["type"] extends "many"
    ? never
    : T[K]["relationalColumn"]]: T[K]["required"] extends true
    ? string
    : string | null;
};

/**
 * Infers the TypeScript type of a collection with relational IDs.
 * Used for mutations where you need to set FK values.
 */
export type InferLiveCollectionWithRelationalIds<T extends LiveCollectionAny> =
  keyof T["relations"] extends string
    ? InferLiveCollectionWithoutRelations<T> &
        InferRelationalColumns<T["relations"]>
    : InferLiveCollectionWithoutRelations<T>;

/**
 * Infers the full TypeScript type of a collection with optional relations.
 *
 * @template T - The collection type
 * @template Include - The include clause specifying which relations to include
 */
export type InferLiveCollection<
  T extends LiveCollectionAny,
  Include extends IncludeClause<T> | undefined = undefined,
> = InferLiveCollectionWithoutRelations<T> &
  (Include extends IncludeClause<T>
    ? {
        [K in keyof T["relations"] as Include[K] extends
          | true
          | SubQueryInclude<T["relations"][K]["entity"]>
          ? K
          : never]: Include[K] extends true
          ? T["relations"][K]["type"] extends "one"
            ? T["fields"][Exclude<
                T["relations"][K]["relationalColumn"],
                undefined
              >] extends NullableLiveType<any>
              ? InferLiveCollection<T["relations"][K]["entity"]> | null
              : InferLiveCollection<T["relations"][K]["entity"]>
            : InferLiveCollection<T["relations"][K]["entity"]>[]
          : Include[K] extends SubQueryInclude<T["relations"][K]["entity"]>
            ? T["relations"][K]["type"] extends "one"
              ? T["fields"][Exclude<
                  T["relations"][K]["relationalColumn"],
                  undefined
                >] extends NullableLiveType<any>
                ? InferLiveCollection<
                    T["relations"][K]["entity"],
                    Include[K]["include"]
                  > | null
                : InferLiveCollection<
                    T["relations"][K]["entity"],
                    Include[K]["include"]
                  >
              : InferLiveCollection<
                  T["relations"][K]["entity"],
                  Include[K]["include"]
                >[]
            : never;
      }
    : object);

type GetFieldType<T> = T extends NullableLiveType<any> ? T["inner"] : T;
type HasDefaultValue<T> =
  T extends LiveAtomicType<any, undefined, any> ? false : true;

/**
 * Infers the insert type for a collection.
 * Fields without defaults are required, fields with defaults are optional.
 */
export type InferInsert<T extends LiveCollectionAny> = {
  [K in keyof T["fields"] as HasDefaultValue<
    GetFieldType<T["fields"][K]>
  > extends true
    ? never
    : K]: InferLiveType<T["fields"][K]>;
} & {
  [K in keyof T["fields"] as HasDefaultValue<
    GetFieldType<T["fields"][K]>
  > extends false
    ? never
    : K]?: InferLiveType<T["fields"][K]>;
};

/**
 * Infers the update type for a collection.
 * All fields are optional except id which is excluded.
 */
export type InferUpdate<T extends LiveCollectionAny> = Omit<
  LiveCollectionMutationInput<T>,
  "id"
>;

/**
 * Extracts the value from a MaterializedLiveType at runtime.
 */
export const inferValue = <T extends LiveTypeAny>(
  type?: MaterializedLiveType<T>
): InferLiveType<T> | undefined => {
  if (!type) return undefined;

  if (Array.isArray(type.value))
    return (type.value as any[]).map((v) => inferValue(v)) as InferLiveType<T>;

  if (
    typeof type.value !== "object" ||
    type.value === null ||
    type.value instanceof Date
  )
    return type.value;

  const result = Object.fromEntries(
    Object.entries(type.value).map(([key, value]) => {
      // If value is already a MaterializedLiveType array, process each element
      if (Array.isArray(value)) {
        return [key, value.map((item) => inferValue(item as any))];
      }
      return [key, inferValue(value as any)];
    })
  ) as InferLiveType<T>;

  return result;
};

// Backwards compatibility aliases

/** @deprecated Use `InferLiveCollection` instead */
export type InferLiveObject<
  T extends LiveCollectionAny,
  Include extends IncludeClause<T> | undefined = undefined,
> = InferLiveCollection<T, Include>;

/** @deprecated Use `InferLiveCollectionWithoutRelations` instead */
export type InferLiveObjectWithoutRelations<T extends LiveCollectionAny> =
  InferLiveCollectionWithoutRelations<T>;

/** @deprecated Use `InferLiveCollectionWithRelationalIds` instead */
export type InferLiveObjectWithRelationalIds<T extends LiveCollectionAny> =
  InferLiveCollectionWithRelationalIds<T>;
