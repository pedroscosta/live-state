/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
import type { Expression, ExpressionBuilder, SelectQueryBuilder } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import type {
  IncludeClause,
  LiveObjectAny,
  Schema,
  WhereClause,
} from "../../schema";

function innerApplyWhere<T extends LiveObjectAny>(
  schema: Schema<any>,
  resourceName: string,
  eb: ExpressionBuilder<any, any>,
  where: WhereClause<T>
): Expression<any> {
  if (!schema) throw new Error("Schema not initialized");

  const resourceSchema = schema[resourceName];

  if (!resourceSchema) throw new Error("Resource not found");

  const isOr = where.$or;
  const isExplictAnd = where.$and;

  return (isOr ? eb.or : eb.and)(
    isOr
      ? where.$or.map((w: WhereClause<T>) =>
          innerApplyWhere(schema, resourceName, eb, w)
        )
      : isExplictAnd
        ? where.$and.map((w: WhereClause<T>) =>
            innerApplyWhere(schema, resourceName, eb, w)
          )
        : Object.entries(where)
            .map(([key, val]) => {
              if (resourceSchema.fields[key]) {
                if (val?.$eq !== undefined) {
                  return eb(
                    `${resourceName}.${key}`,
                    val.$eq === null ? "is" : "=",
                    val.$eq
                  );
                } else if (val?.$in !== undefined) {
                  return eb(`${resourceName}.${key}`, "in", val.$in);
                } else if (val?.$not !== undefined) {
                  if (val?.$not?.$in !== undefined) {
                    return eb(`${resourceName}.${key}`, "not in", val.$not.$in);
                  } else if (val?.$not?.$eq !== undefined) {
                    return eb(
                      `${resourceName}.${key}`,
                      val.$not.$eq === null ? "is not" : "!=",
                      val.$not.$eq
                    );
                  } else {
                    return eb(
                      `${resourceName}.${key}`,
                      val.$not === null ? "is not" : "!=",
                      val.$not
                    );
                  }
                } else if (val?.$gt !== undefined) {
                  return eb(`${resourceName}.${key}`, ">", val.$gt);
                } else if (val?.$gte !== undefined) {
                  return eb(`${resourceName}.${key}`, ">=", val.$gte);
                } else if (val?.$lt !== undefined) {
                  return eb(`${resourceName}.${key}`, "<", val.$lt);
                } else if (val?.$lte !== undefined) {
                  return eb(`${resourceName}.${key}`, "<=", val.$lte);
                } else {
                  // Fallback to simple field equality
                  return eb(
                    `${resourceName}.${key}`,
                    val === null ? "is" : "=",
                    val
                  );
                }
              } else if (resourceSchema.relations[key]) {
                const relation = resourceSchema.relations[key];
                const otherResourceName = relation.entity.name;

                const otherColumnName =
                  relation.type === "one" ? "id" : relation.foreignColumn;

                const selfColumn =
                  relation.type === "one" ? relation.relationalColumn : "id";

                return innerApplyWhere(schema, otherResourceName, eb, val);
              }
              return null;
            })
            .filter(Boolean)
  );
}

function applyJoins<T extends LiveObjectAny>(
  schema: Schema<any>,
  resourceName: string,
  query: SelectQueryBuilder<any, any, any>,
  where?: WhereClause<T>
) {
  const resourceSchema = schema[resourceName];

  if (!resourceSchema) throw new Error("Resource not found");

  if (!where) return query;

  for (const key of Object.keys(where)) {
    if (!resourceSchema.relations[key]) continue;

    const relation = resourceSchema.relations[key];
    const otherResourceName = relation.entity.name;

    const otherColumnName =
      relation.type === "one" ? "id" : relation.foreignColumn;

    const selfColumn =
      relation.type === "one" ? relation.relationalColumn : "id";

    query = query.leftJoin(
      otherResourceName,
      `${otherResourceName}.${otherColumnName}`,
      `${resourceName}.${selfColumn}`
    );
  }

  return query;
}

export function applyWhere<T extends LiveObjectAny>(
  schema: Schema<any>,
  resourceName: string,
  query: SelectQueryBuilder<any, any, any>,
  where?: WhereClause<T>
) {
  if (!where || Object.keys(where).length === 0) return query;

  query = applyJoins(schema, resourceName, query, where);

  return query.where((eb) => innerApplyWhere(schema, resourceName, eb, where));
}

export function applyInclude<T extends LiveObjectAny>(
  schema: Schema<any>,
  resourceName: string,
  query: SelectQueryBuilder<any, any, any>,
  include?: IncludeClause<T>
) {
  if (!include) return query;

  if (!schema) throw new Error("Schema not initialized");

  const resourceSchema = schema[resourceName];

  if (!resourceSchema) throw new Error(`Resource not found: ${resourceName}`);

  for (const key of Object.keys(include)) {
    if (!resourceSchema.relations[key])
      throw new Error(`Relation ${key} not found in resource ${resourceName}`);

    const relation = resourceSchema.relations[key];
    const otherResourceName = relation.entity.name as string;

    const otherColumnName =
      relation.type === "one" ? "id" : relation.foreignColumn;

    const selfColumn =
      relation.type === "one" ? relation.relationalColumn : "id";

    const aggFunc = relation.type === "one" ? jsonObjectFrom : jsonArrayFrom;

    query = query.select((eb) =>
      (
        aggFunc(
          eb
            .selectFrom(otherResourceName)
            .selectAll(otherResourceName)
            .whereRef(
              `${otherResourceName}.${otherColumnName}`,
              "=",
              `${resourceName}.${selfColumn}`
            )
            .select((eb: any) =>
              jsonObjectFrom(
                eb
                  .selectFrom(`${otherResourceName}_meta`)
                  .selectAll(`${otherResourceName}_meta`)
                  .whereRef(
                    `${otherResourceName}_meta.id`,
                    "=",
                    `${otherResourceName}.id`
                  )
              ).as("_meta")
            )
        ) as ReturnType<typeof jsonObjectFrom>
      ).as(key)
    );

    // TODO support deep include
    // query = this.applyInclude(otherResourceName, query, val);
  }

  return query;
}
