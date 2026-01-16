/** biome-ignore-all lint/complexity/noBannedTypes: false positive */
import type { LiveCollectionAny } from "./collection";
import type { InferLiveType } from "./types";

/**
 * Where clause for filtering collections.
 * Supports field comparisons, operators, and nested relation queries.
 */
export type WhereClause<T extends LiveCollectionAny> =
  | ({
      [K in keyof T["fields"]]?:
        | InferLiveType<T["fields"][K]>
        | ({
            $eq?: InferLiveType<T["fields"][K]>;
            $in?: InferLiveType<T["fields"][K]>[];
            $not?:
              | InferLiveType<T["fields"][K]>
              | {
                  $in?: InferLiveType<T["fields"][K]>[];
                  $eq?: InferLiveType<T["fields"][K]>;
                };
          } & (Exclude<InferLiveType<T["fields"][K]>, null | undefined> extends
            | number
            | Date
            ? {
                $gt?: InferLiveType<T["fields"][K]>;
                $gte?: InferLiveType<T["fields"][K]>;
                $lt?: InferLiveType<T["fields"][K]>;
                $lte?: InferLiveType<T["fields"][K]>;
              }
            : {}));
    } & {
      [K in keyof T["relations"]]?: WhereClause<T["relations"][K]["entity"]>;
    })
  | {
      $and?: WhereClause<T>[];
      $or?: WhereClause<T>[];
    };

/**
 * Sub-query options for nested includes.
 * Allows filtering, sorting, and pagination of related collections.
 */
export type SubQueryInclude<T extends LiveCollectionAny> = {
  where?: WhereClause<T>;
  limit?: number;
  orderBy?: { key: keyof T["fields"] & string; direction: "asc" | "desc" }[];
  include?: IncludeClause<T>;
};

/**
 * Include clause for specifying which relations to fetch.
 * Can be a boolean or a sub-query for fine-grained control.
 */
export type IncludeClause<T extends LiveCollectionAny> = {
  [K in keyof T["relations"]]?:
    | boolean
    | SubQueryInclude<T["relations"][K]["entity"]>;
};
