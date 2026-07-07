/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
import type {
  Expression,
  ExpressionBuilder,
  Kysely,
  SelectQueryBuilder,
} from "kysely";
import type {
  IncludeClause,
  LiveObjectAny,
  Schema,
  WhereClause,
} from "../../schema";
import { isSubQueryInclude } from "../../utils";
import { type DialectHelpers, detectDialect } from "./dialect-helpers";

function innerApplyWhere<T extends LiveObjectAny>(
  schema: Schema<any>,
  resource: string,
  eb: ExpressionBuilder<any, any>,
  where: WhereClause<T>
): Expression<any> {
  if (!schema) throw new Error("Schema not initialized");

  const resourceSchema = schema[resource];

  if (!resourceSchema) throw new Error("Resource not found");

  const isOr = where.$or;
  const isExplicitAnd = where.$and;

  return (isOr ? eb.or : eb.and)(
    isOr
      ? where.$or.map((w: WhereClause<T>) =>
          innerApplyWhere(schema, resource, eb, w)
        )
      : isExplicitAnd
        ? where.$and.map((w: WhereClause<T>) =>
            innerApplyWhere(schema, resource, eb, w)
          )
        : Object.entries(where)
            .map(([key, val]) => {
              if (resourceSchema.fields[key]) {
                if (val?.$eq !== undefined) {
                  return eb(
                    `${resource}.${key}`,
                    val.$eq === null ? "is" : "=",
                    val.$eq
                  );
                } else if (val?.$in !== undefined) {
                  return eb(`${resource}.${key}`, "in", val.$in);
                } else if (val?.$not !== undefined) {
                  if (val?.$not?.$in !== undefined) {
                    return eb(`${resource}.${key}`, "not in", val.$not.$in);
                  } else if (val?.$not?.$eq !== undefined) {
                    return eb(
                      `${resource}.${key}`,
                      val.$not.$eq === null ? "is not" : "!=",
                      val.$not.$eq
                    );
                  } else {
                    return eb(
                      `${resource}.${key}`,
                      val.$not === null ? "is not" : "!=",
                      val.$not
                    );
                  }
                } else if (val?.$gt !== undefined) {
                  return eb(`${resource}.${key}`, ">", val.$gt);
                } else if (val?.$gte !== undefined) {
                  return eb(`${resource}.${key}`, ">=", val.$gte);
                } else if (val?.$lt !== undefined) {
                  return eb(`${resource}.${key}`, "<", val.$lt);
                } else if (val?.$lte !== undefined) {
                  return eb(`${resource}.${key}`, "<=", val.$lte);
                } else {
                  return eb(
                    `${resource}.${key}`,
                    val === null ? "is" : "=",
                    val
                  );
                }
              } else if (resourceSchema.relations[key]) {
                const relation = resourceSchema.relations[key];
                const otherResource = relation.entity.name;

                if (relation.type === "many") {
                  return eb.exists(
                    applyWhere(
                      schema,
                      otherResource,
                      eb
                        .selectFrom(otherResource)
                        // @ts-expect-error
                        .select("id")
                        .whereRef(
                          relation.foreignColumn,
                          "=",
                          `${resource}.id`
                        ),
                      val
                    )
                  );
                }

                return innerApplyWhere(schema, otherResource, eb, val);
              }
              return null;
            })
            .filter(Boolean)
  );
}

function applyJoins<T extends LiveObjectAny>(
  schema: Schema<any>,
  resource: string,
  query: SelectQueryBuilder<any, any, any>,
  where?: WhereClause<T>,
  // A single relation may be referenced by several branches of the same `where`
  // (e.g. a cursor predicate `{ $or: [{ author: ... }, { $and: [{ author: ... },
  // ...] }] }`). Each branch would otherwise `leftJoin` the same table, which the
  // SQL dialect rejects. Track joined tables so each is joined at most once per
  // query. `one` relations always join on the same key, so deduping is safe.
  joined: Set<string> = new Set()
) {
  const resourceSchema = schema[resource];

  if (!resourceSchema) throw new Error("Resource not found");

  if (!where) return query;

  if (where.$and) {
    for (const w of where.$and as WhereClause<T>[]) {
      query = applyJoins(schema, resource, query, w, joined);
    }
    return query;
  } else if (where.$or) {
    for (const w of where.$or as WhereClause<T>[]) {
      query = applyJoins(schema, resource, query, w, joined);
    }
    return query;
  }

  for (const [key, value] of Object.entries(where)) {
    if (!resourceSchema.relations[key]) continue;

    const relation = resourceSchema.relations[key];
    const otherresource = relation.entity.name;

    const otherColumnName =
      relation.type === "one" ? "id" : relation.foreignColumn;

    const selfColumn =
      relation.type === "one" ? relation.relationalColumn : "id";

    if (!joined.has(otherresource)) {
      joined.add(otherresource);
      query = query.leftJoin(
        otherresource,
        `${otherresource}.${otherColumnName}`,
        `${resource}.${selfColumn}`
      );
    }

    if (value instanceof Object && !Array.isArray(value) && value !== null) {
      query = applyJoins(schema, otherresource, query, value, joined);
    }
  }

  return query;
}

export function applyWhere<T extends LiveObjectAny>(
  schema: Schema<any>,
  resource: string,
  query: SelectQueryBuilder<any, any, any>,
  where?: WhereClause<T>
) {
  if (!where || Object.keys(where).length === 0) return query;

  query = applyJoins(schema, resource, query, where);

  return query.where((eb) => innerApplyWhere(schema, resource, eb, where));
}

function selectMetaColumns(
  eb: any,
  schema: Schema<any>,
  resourceName: string,
  metaTableName: string,
  db: Kysely<any>
): any {
  const dialect = detectDialect(db);
  const entity = schema[resourceName];

  if (dialect === "sqlite" && entity?.fields) {
    const fieldNames = Object.keys(entity.fields);
    let query = eb.selectFrom(metaTableName);
    for (const fieldName of fieldNames) {
      query = query.select(`${metaTableName}.${fieldName}`);
    }
    return query;
  }

  return eb.selectFrom(metaTableName).selectAll(metaTableName);
}

function selectMainColumns(
  eb: any,
  schema: Schema<any>,
  resourceName: string,
  tableName: string,
  db: Kysely<any>
): any {
  const dialect = detectDialect(db);
  const entity = schema[resourceName];

  if (dialect === "sqlite" && entity?.fields) {
    const fieldNames = Object.keys(entity.fields);
    let query = eb.selectFrom(tableName);
    for (const fieldName of fieldNames) {
      query = query.select(`${tableName}.${fieldName}`);
    }
    return query;
  }

  return eb.selectFrom(tableName).selectAll(tableName);
}

/**
 * Apply a `sort` spec to a query, resolving relational sort keys. An own-column
 * key (`"name"`) becomes a plain `orderBy`; a relational key (`"author.name"`)
 * orders by a *related* object's column, resolved with a correlated scalar
 * subquery rather than a join so it never conflicts with joins the `where`
 * clause may already add. Shared by the root query (`sql-storage.get`) and every
 * windowed `include` (`applyInclude`), so relational ordering resolves the same
 * way at any nesting depth.
 */
export function applyRelationalOrderBy(
  schema: Schema<any>,
  resource: string,
  query: SelectQueryBuilder<any, any, any>,
  sort: { key: string; direction: "asc" | "desc" }[]
): SelectQueryBuilder<any, any, any> {
  for (const s of sort) {
    const dot = s.key.indexOf(".");
    if (dot !== -1) {
      const relationName = s.key.slice(0, dot);
      const field = s.key.slice(dot + 1);
      const relation = schema?.[resource]?.relations?.[relationName];

      if (relation?.type === "one" && relation.relationalColumn) {
        const otherResource = relation.entity.name;
        const relationalColumn = String(relation.relationalColumn);
        query = query.orderBy(
          (eb: any) =>
            eb
              .selectFrom(otherResource)
              .select(`${otherResource}.${field}`)
              .whereRef(
                `${otherResource}.id`,
                "=",
                `${resource}.${relationalColumn}`
              ),
          s.direction
        );
        continue;
      }

      // A dotted key that resolves to a relation we can't order by (a `many`
      // relation, or a `one` without a `relationalColumn`) would otherwise fall
      // through and hand the raw `"relation.field"` to `orderBy`, surfacing as an
      // opaque missing-FROM SQL error. Fail with a clear one.
      if (relation) {
        throw new Error(
          `Relational sort on "${s.key}" is only supported for "one" relations with a relationalColumn`
        );
      }
    }

    query = query.orderBy(s.key, s.direction);
  }

  return query;
}

export function applyInclude<T extends LiveObjectAny>(
  schema: Schema<any>,
  resource: string,
  query: SelectQueryBuilder<any, any, any>,
  include: IncludeClause<T> | undefined,
  dialectHelpers: DialectHelpers,
  db: Kysely<any>
) {
  if (!include) return query;

  if (!schema) throw new Error("Schema not initialized");

  const resourceSchema = schema[resource];

  if (!resourceSchema) throw new Error(`Resource not found: ${resource}`);

  const { jsonObjectFrom, jsonArrayFrom } = dialectHelpers;

  for (const key of Object.keys(include)) {
    if (!resourceSchema.relations[key])
      throw new Error(`Relation ${key} not found in resource ${resource}`);

    const relation = resourceSchema.relations[key];
    const otherresource = relation.entity.name as string;
    const includeValue = include[key];

    const otherColumnName =
      relation.type === "one" ? "id" : relation.foreignColumn;

    const selfColumn =
      relation.type === "one" ? relation.relationalColumn : "id";

    const aggFunc = relation.type === "one" ? jsonObjectFrom : jsonArrayFrom;

    // An include value is either a sub-query (`{ where?, limit?, orderBy?,
    // include? }`) or a plain-nested include map whose own keys are further
    // relations (`{ posts: { comments: true } }`). For the latter the value
    // itself is the nested include — mirror the client's interpretation.
    const subQueryOptions = isSubQueryInclude(includeValue) ? includeValue : null;
    const nestedInclude = subQueryOptions
      ? subQueryOptions.include
      : includeValue && typeof includeValue === "object"
        ? (includeValue as Record<string, any>)
        : undefined;

    query = query.select((eb) => {
      const metaTableName = `${otherresource}_meta`;
      let subQuery = selectMainColumns(
        eb,
        schema,
        otherresource,
        otherresource,
        db
      )
        .whereRef(
          `${otherresource}.${otherColumnName}`,
          "=",
          `${resource}.${selfColumn}`
        )
        .select((eb: any) =>
          jsonObjectFrom(
            selectMetaColumns(
              eb,
              schema,
              otherresource,
              metaTableName,
              db
            ).whereRef(`${metaTableName}.id`, "=", `${otherresource}.id`)
          ).as("_meta")
        );

      // Apply sub-query where clause
      if (subQueryOptions?.where) {
        subQuery = applyWhere(
          schema,
          otherresource,
          subQuery,
          subQueryOptions.where
        );
      }

      // Apply sub-query orderBy, resolving relational sort keys (`assignee.name`)
      // relative to the included resource so a windowed include's `LIMIT` selects
      // the correct per-parent top-N.
      if (subQueryOptions?.orderBy) {
        subQuery = applyRelationalOrderBy(
          schema,
          otherresource,
          subQuery,
          subQueryOptions.orderBy
        );
      }

      // Apply sub-query limit
      if (subQueryOptions?.limit !== undefined) {
        subQuery = subQuery.limit(subQueryOptions.limit);
      }

      // Apply nested includes (recursive)
      if (nestedInclude && Object.keys(nestedInclude).length > 0) {
        subQuery = applyInclude(
          schema,
          otherresource,
          subQuery,
          nestedInclude,
          dialectHelpers,
          db
        );
      }

      return (aggFunc(subQuery) as ReturnType<typeof jsonObjectFrom>).as(key);
    });
  }

  return query;
}
