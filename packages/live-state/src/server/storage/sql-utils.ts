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
                  // Fallback to simple field equality
                  return eb(
                    `${resource}.${key}`,
                    val === null ? "is" : "=",
                    val
                  );
                }
              } else if (resourceSchema.relations[key]) {
                const relation = resourceSchema.relations[key];
                const otherresource = relation.entity.name;

                return innerApplyWhere(schema, otherresource, eb, val);
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

  for (const key of Object.keys(where)) {
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

export function applyInclude<T extends LiveObjectAny>(
  schema: Schema<any>,
  resource: string,
  query: SelectQueryBuilder<any, any, any>,
  include?: IncludeClause<T>
) {
  if (!include) return query;

  if (!schema) throw new Error("Schema not initialized");

  const resourceSchema = schema[resource];

  if (!resourceSchema) throw new Error(`Resource not found: ${resource}`);

  for (const key of Object.keys(include)) {
    if (!resourceSchema.relations[key])
      throw new Error(`Relation ${key} not found in resource ${resource}`);

    const relation = resourceSchema.relations[key];
    const otherresource = relation.entity.name as string;

    const otherColumnName =
      relation.type === "one" ? "id" : relation.foreignColumn;

    const selfColumn =
      relation.type === "one" ? relation.relationalColumn : "id";

    const aggFunc = relation.type === "one" ? jsonObjectFrom : jsonArrayFrom;

    query = query.select((eb) =>
      (
        aggFunc(
          eb
            .selectFrom(otherresource)
            .selectAll(otherresource)
            .whereRef(
              `${otherresource}.${otherColumnName}`,
              "=",
              `${resource}.${selfColumn}`
            )
            .select((eb: any) =>
              jsonObjectFrom(
                eb
                  .selectFrom(`${otherresource}_meta`)
                  .selectAll(`${otherresource}_meta`)
                  .whereRef(
                    `${otherresource}_meta.id`,
                    "=",
                    `${otherresource}.id`
                  )
              ).as("_meta")
            )
        ) as ReturnType<typeof jsonObjectFrom>
      ).as(key)
    );

    // TODO support deep include
    // query = this.applyInclude(otherresource, query, val);
  }

  return query;
}
