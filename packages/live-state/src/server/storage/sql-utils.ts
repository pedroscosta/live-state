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
  where?: WhereClause<T>
) {
  const resourceSchema = schema[resource];

  if (!resourceSchema) throw new Error("Resource not found");

  if (!where) return query;

  if (where.$and) {
    for (const w of where.$and as WhereClause<T>[]) {
      query = applyJoins(schema, resource, query, w);
    }
    return query;
  } else if (where.$or) {
    for (const w of where.$or as WhereClause<T>[]) {
      query = applyJoins(schema, resource, query, w);
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

    query = query.leftJoin(
      otherresource,
      `${otherresource}.${otherColumnName}`,
      `${resource}.${selfColumn}`
    );

    if (value instanceof Object && !Array.isArray(value) && value !== null) {
      query = applyJoins(schema, otherresource, query, value);
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

    const isNestedInclude =
      typeof includeValue === "object" && includeValue !== null;

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

      if (isNestedInclude) {
        subQuery = applyInclude(
          schema,
          otherresource,
          subQuery,
          includeValue,
          dialectHelpers,
          db
        );
      }

      return (aggFunc(subQuery) as ReturnType<typeof jsonObjectFrom>).as(key);
    });
  }

  return query;
}
