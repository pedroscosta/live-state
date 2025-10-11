/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
import {
  type ControlledTransaction,
  Kysely,
  PostgresDialect,
  type PostgresPool,
  type Selectable,
} from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import {
  type IncludeClause,
  type InferLiveObject,
  inferValue,
  type LiveObjectAny,
  type LiveTypeAny,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../../schema";
import { Storage } from "./interface";
import { applyInclude, applyWhere } from "./sql-utils";

export class SQLStorage extends Storage {
  private db: Kysely<{ [x: string]: Selectable<any> }>;
  private schema?: Schema<any>;

  public constructor(pool: PostgresPool);
  /** @internal */
  public constructor(
    db: Kysely<{ [x: string]: Selectable<any> }>,
    schema: Schema<any>
  );
  public constructor(
    poolOrDb: PostgresPool | Kysely<{ [x: string]: Selectable<any> }>,
    schema?: Schema<any>
  ) {
    super();

    if (this.isKyselyLike(poolOrDb)) {
      this.db = poolOrDb as Kysely<{ [x: string]: Selectable<any> }>;
    } else {
      this.db = new Kysely({
        dialect: new PostgresDialect({
          pool: poolOrDb,
        }),
      });
    }

    this.schema = schema;

    this.rawInsert = this.rawInsert.bind(this);
    this.rawUpdate = this.rawUpdate.bind(this);
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
    if (!this.schema) throw new Error("Schema not initialized");

    let query = await this.db
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
      );

    query = applyInclude(this.schema, resourceName, query, include);

    const rawValue = await query.executeTakeFirst();

    if (!rawValue) return;

    return this.convertToMaterializedLiveType(rawValue);
  }

  public async findOne<T extends LiveObjectAny>(
    resource: T,
    id: string,
    options?: {
      include?: IncludeClause<T>;
    }
  ): Promise<InferLiveObject<T> | undefined> {
    const rawValue = await this.rawFindById(
      resource.name,
      id,
      options?.include
    );

    if (!rawValue) return;

    return inferValue(rawValue) as InferLiveObject<T>;
  }

  /** @internal */
  public async rawFind<T extends LiveObjectAny>(
    resourceName: string,
    where?: WhereClause<T>,
    include?: IncludeClause<T>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    if (!this.schema) throw new Error("Schema not initialized");

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
      );

    query = applyWhere(this.schema, resourceName, query, where);
    console.log("query", query.compile());

    query = applyInclude(this.schema, resourceName, query, include);

    const rawResult = await query.execute();

    const rawValues: Record<string, Record<string, any>> = Object.fromEntries(
      rawResult.map((v) => {
        const { id } = v;
        return [id, v];
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

  public async find<T extends LiveObjectAny>(
    resource: T,
    options?: {
      where?: WhereClause<T>;
      include?: IncludeClause<T>;
    }
  ): Promise<Record<string, InferLiveObject<T>>> {
    const rawResult = await this.rawFind(
      resource.name,
      options?.where,
      options?.include
    );

    return Object.fromEntries(
      Object.entries(rawResult).map(([id, value]) => {
        return [id, inferValue(value) as InferLiveObject<T>];
      })
    );
  }

  /** @internal */
  public async rawInsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>> {
    const values: Record<string, any> = {};
    const metaValues: Record<string, string> = {};

    for (const [key, val] of Object.entries(value.value)) {
      const metaVal = val._meta?.timestamp;
      if (!metaVal) continue;
      values[key] = val.value;
      metaValues[key] = metaVal;
    }

    await this.db
      .insertInto(resourceName)
      .values({ ...values, id: resourceId })
      .execute()
      .then(() => {
        this.db
          .insertInto(`${resourceName}_meta`)
          .values({ ...metaValues, id: resourceId })
          .execute();
      });

    return value;
  }

  /** @internal */
  public async rawUpdate<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>> {
    const values: Record<string, any> = {};
    const metaValues: Record<string, string> = {};

    for (const [key, val] of Object.entries(value.value)) {
      const metaVal = val._meta?.timestamp;
      if (!metaVal) continue;
      values[key] = val.value;
      metaValues[key] = metaVal;
    }

    await Promise.all([
      this.db
        .updateTable(resourceName)
        .set(values)
        .where("id", "=", resourceId)
        .execute(),
      this.db
        .insertInto(`${resourceName}_meta`)
        .values({ ...metaValues, id: resourceId })
        .onConflict((oc) => oc.column("id").doUpdateSet(metaValues))
        .execute(),
    ]);

    return value;
  }

  public async transaction<T>(
    fn: (opts: {
      trx: Storage;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
    }) => Promise<T>
  ): Promise<T> {
    if (!this.schema) throw new Error("Schema not initialized");

    if (this.db.isTransaction) {
      const savepointName = Math.random().toString(36).substring(2, 15);

      const trx = await (this.db as ControlledTransaction<any>)
        .savepoint(savepointName)
        .execute();

      try {
        return await fn({
          trx: this,
          commit: () =>
            trx
              .releaseSavepoint(savepointName)
              .execute()
              .then(() => {}),
          rollback: () =>
            trx
              .rollbackToSavepoint(savepointName)
              .execute()
              .then(() => {}),
        }).then((v) => {
          if (trx.isCommitted || trx.isRolledBack) return v;

          return trx
            .releaseSavepoint(savepointName)
            .execute()
            .then(() => v);
        });
      } catch (e) {
        await trx
          .rollbackToSavepoint(savepointName)
          .execute()
          .catch(() => {
            // Ignoring this error because it's already rolled back
          });
        throw e;
      }
    }

    const trx = await this.db.startTransaction().execute();

    try {
      return await fn({
        trx: new SQLStorage(trx as typeof this.db, this.schema),
        commit: () => trx.commit().execute(),
        rollback: () => trx.rollback().execute(),
      }).then((v) => {
        if (trx.isCommitted || trx.isRolledBack) return v;

        return trx
          .commit()
          .execute()
          .then(() => v);
      });
    } catch (e) {
      await trx.rollback().execute();
      throw e;
    }
  }

  private convertToMaterializedLiveType<T extends LiveObjectAny>(
    value: Record<string, any>
  ): MaterializedLiveType<T> {
    return {
      value: Object.entries(value).reduce((acc, [key, val]) => {
        if (key === "_meta") return acc;

        if (key === "id") {
          acc[key] = {
            value: val,
          };
        } else if (Array.isArray(val)) {
          acc[key] = {
            value: val.map((v) => this.convertToMaterializedLiveType(v)),
            _meta: { timestamp: value?._meta?.[key] },
          };
        } else if (
          typeof val === "object" &&
          val !== null &&
          !(val instanceof Date)
        ) {
          acc[key] = {
            ...this.convertToMaterializedLiveType(val),
            _meta: { timestamp: value?._meta?.[key] },
          };
        } else {
          acc[key] = {
            value: val,
            _meta: { timestamp: value?._meta?.[key] },
          };
        }

        return acc;
      }, {} as any),
    } as unknown as MaterializedLiveType<T>;
  }

  private isKyselyLike(
    value: PostgresPool | Kysely<{ [x: string]: Selectable<any> }>
  ): value is Kysely<{ [x: string]: Selectable<any> }> {
    if (value instanceof Kysely) return true;
    if (!value || typeof value !== "object") return false;

    const candidate = value as unknown as Record<string, unknown>;
    const hasSelectFrom = typeof candidate.selectFrom === "function";
    const hasStartTransaction =
      typeof candidate.startTransaction === "function";
    const hasSavepoint = typeof candidate.savepoint === "function";
    const hasIsTransaction =
      typeof candidate.isTransaction === "boolean" ||
      typeof candidate.isTransaction === "function";

    return (
      (hasSelectFrom && hasStartTransaction) ||
      (hasSavepoint && hasIsTransaction)
    );
  }
}
