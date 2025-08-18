import { Kysely, PostgresDialect, PostgresPool, Selectable } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import {
  IncludeClause,
  LiveObjectAny,
  LiveTypeAny,
  MaterializedLiveType,
  Schema,
  WhereClause,
} from "../schema";

export abstract class Storage {
  /** @internal */
  public abstract updateSchema(opts: Schema<any>): Promise<void>;

  /** @internal */
  public abstract rawFindById<T extends LiveObjectAny>(
    resourceName: string,
    id: string,
    include?: IncludeClause<T>
  ): Promise<MaterializedLiveType<T> | undefined>;

  /** @internal */
  public abstract rawFind<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>,
    include?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>>;

  /** @internal */
  public abstract rawUpsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>>;
}

type SimpleKyselyQueryInterface = {
  where: (
    column: string,
    operator: string,
    value: any
  ) => SimpleKyselyQueryInterface;
  leftJoin: (
    table: string,
    field1: string,
    field2: string
  ) => SimpleKyselyQueryInterface;
  executeTakeFirst: () => Promise<Record<string, any>>;
  execute: () => Promise<Record<string, any>[]>;
  select: (eb: (eb: any) => any) => SimpleKyselyQueryInterface;
};

export class SQLStorage extends Storage {
  private db: Kysely<{ [x: string]: Selectable<any> }>;
  private schema?: Schema<any>;

  public constructor(pool: PostgresPool) {
    super();
    this.db = new Kysely({
      dialect: new PostgresDialect({
        pool,
      }),
    });
  }

  /** @internal */
  public async updateSchema(opts: Schema<any>): Promise<void> {
    this.schema = opts;

    const tables = await this.db.introspection.getTables();

    for (const [resourceName, entity] of Object.entries(opts)) {
      const table = tables.find((table) => table.name === resourceName);
      if (!table)
        await this.db.schema.createTable(resourceName).ifNotExists().execute();

      const tableMetaName = `${resourceName}_meta`;
      const tableMeta = tables.find((table) => table.name === tableMetaName);

      if (!tableMeta) {
        // TODO add a last updated column
        await this.db.schema.createTable(tableMetaName).ifNotExists().execute();
      }

      for (const [columnName, column] of Object.entries(entity.fields)) {
        const tableColumn = table?.columns.find(
          (column) => column.name === columnName
        );

        const storageFieldType = (column as LiveTypeAny).getStorageFieldType();

        if (!tableColumn) {
          await this.db.schema
            .alterTable(resourceName)
            .addColumn(columnName, storageFieldType.type as any, (c) => {
              let builder = c;

              if (storageFieldType.unique) {
                builder = builder.unique();
              }

              if (!storageFieldType.nullable) {
                builder = builder.notNull();
              }

              if (storageFieldType.references) {
                builder = builder.references(storageFieldType.references);
              }

              if (storageFieldType.primary) {
                builder = builder.primaryKey();
              }

              if (storageFieldType.default !== undefined) {
                builder = builder.defaultTo(storageFieldType.default);
              }

              return builder;
            })
            .execute()
            .catch((e) => {
              console.error("Error adding column", columnName, e);
              throw e;
            });

          if (storageFieldType.index) {
            await this.db.schema
              .createIndex(`${resourceName}_${columnName}_index`)
              .on(resourceName)
              .column(columnName)
              .execute()
              .catch((e) => {});
          }
        } else if (tableColumn.dataType !== storageFieldType.type) {
          console.error(
            "Column type mismatch:",
            columnName,
            "expected to have type:",
            storageFieldType.type,
            "but has type:",
            tableColumn.dataType
          );
        }

        const columnMeta = tableMeta?.columns.find(
          (column) => column.name === columnName
        );

        if (!columnMeta) {
          await this.db.schema
            .alterTable(tableMetaName)
            .addColumn(columnName, "varchar", (c) => {
              let builder = c;

              if (storageFieldType.primary) {
                builder = builder
                  .primaryKey()
                  .references(`${resourceName}.${columnName}`);
              }

              return builder;
            })
            .execute();
        }
      }
    }
  }

  /** @internal */
  public async rawFindById<T extends LiveObjectAny>(
    resourceName: string,
    id: string,
    include?: IncludeClause<T>
  ): Promise<MaterializedLiveType<T> | undefined> {
    let query = (await this.db
      .selectFrom(resourceName)
      .where("id", "=", id)
      .selectAll(resourceName)
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom(`${resourceName}_meta`)
            .selectAll(`${resourceName}_meta`)
            .whereRef(`${resourceName}_meta.id`, "=", `${resourceName}.id`)
        ).as("_meta")
      )) as unknown as SimpleKyselyQueryInterface;

    query = this.applyInclude(resourceName, query, include);

    const rawValue = await query.executeTakeFirst();

    if (!rawValue) return;

    return this.convertToMaterializedLiveType(rawValue);
  }

  /** @internal */
  public async rawFind<T extends LiveObjectAny>(
    resourceName: string,
    where?: WhereClause<T>,
    include?: IncludeClause<T>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    let query = this.db
      .selectFrom(resourceName)
      .selectAll(resourceName)
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom(`${resourceName}_meta`)
            .selectAll(`${resourceName}_meta`)
            .whereRef(`${resourceName}_meta.id`, "=", `${resourceName}.id`)
        ).as("_meta")
      ) as unknown as SimpleKyselyQueryInterface;

    query = this.applyWhere(resourceName, query, where);

    query = this.applyInclude(resourceName, query, include);

    const rawResult = await query.execute();

    const rawValues: Record<string, Record<string, any>> = Object.fromEntries(
      rawResult.map((v) => {
        const { id, ...rest } = v;
        return [id, rest];
      })
    );

    if (Object.keys(rawValues).length === 0) return {};

    const value = Object.entries(rawValues).reduce(
      (acc, [id, value]) => {
        acc[id] = this.convertToMaterializedLiveType(value);
        return acc;
      },
      {} as Record<string, MaterializedLiveType<T>>
    );

    return value;
  }

  /** @internal */
  public async rawUpsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>> {
    await this.db.transaction().execute(async (trx) => {
      const exists = !!(await trx
        .selectFrom(resourceName)
        .select("id")
        .where("id", "=", resourceId)
        .executeTakeFirst());

      const values: Record<string, any> = {};
      const metaValues: Record<string, string> = {};

      for (const [key, val] of Object.entries(value.value)) {
        values[key] = val.value;
        metaValues[key] = val._meta.timestamp;
      }

      if (exists) {
        await Promise.all([
          trx
            .updateTable(resourceName)
            .set(values)
            .where("id", "=", resourceId)
            .execute(),
          trx
            .updateTable(`${resourceName}_meta`)
            .set(metaValues)
            .where("id", "=", resourceId)
            .execute(),
        ]);
      } else {
        await Promise.all([
          trx
            .insertInto(resourceName)
            .values({ ...values, id: resourceId })
            .execute(),
          trx
            .insertInto(`${resourceName}_meta`)
            .values({ ...metaValues, id: resourceId })
            .execute(),
        ]);
      }
    });

    return value;
  }

  private convertToMaterializedLiveType<T extends LiveObjectAny>(
    value: Record<string, any>
  ): MaterializedLiveType<T> {
    if (!value._meta) throw new Error("Missing _meta");

    return {
      value: Object.entries(value).reduce((acc, [key, val]) => {
        if (key === "_meta") return acc;

        if (key === "id") {
          acc[key] = {
            value: val,
          };
        } else if (typeof val === "object") {
          acc[key] = {
            ...this.convertToMaterializedLiveType(val),
            _meta: { timestamp: value._meta[key] },
          };
        } else if (Array.isArray(val)) {
          acc[key] = {
            value: val.map((v) => this.convertToMaterializedLiveType(v)),
            _meta: { timestamp: value._meta[key] },
          };
        } else {
          acc[key] = {
            value: val,
            _meta: { timestamp: value._meta[key] },
          };
        }

        return acc;
      }, {} as any),
    } as unknown as MaterializedLiveType<T>;
  }

  private applyWhere<T extends LiveObjectAny>(
    resourceName: string,
    query: SimpleKyselyQueryInterface,
    where?: WhereClause<T>
  ) {
    if (!where) return query;

    if (!this.schema) throw new Error("Schema not initialized");

    const resourceSchema = this.schema[resourceName];

    if (!resourceSchema) throw new Error("Resource not found");

    for (const [key, val] of Object.entries(where)) {
      if (resourceSchema.fields[key]) {
        query = query.where(`${resourceName}.${key}`, "=", val);
      } else if (resourceSchema.relations[key]) {
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
        query = this.applyWhere(otherResourceName, query, val);
      }
    }

    return query;
  }

  private applyInclude<T extends LiveObjectAny>(
    resourceName: string,
    query: SimpleKyselyQueryInterface,
    include?: IncludeClause<T>
  ) {
    if (!include) return query;

    if (!this.schema) throw new Error("Schema not initialized");

    const resourceSchema = this.schema[resourceName];

    if (!resourceSchema) throw new Error(`Resource not found: ${resourceName}`);

    for (const [key, val] of Object.entries(include)) {
      if (!resourceSchema.relations[key])
        throw new Error(
          `Relation ${key} not found in resource ${resourceName}`
        );

      const relation = resourceSchema.relations[key];
      const otherResourceName = relation.entity.name;

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
}
