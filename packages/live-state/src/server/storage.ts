import { Kysely, PostgresDialect, PostgresPool, Selectable } from "kysely";
import {
  LiveObjectAny,
  LiveTypeAny,
  MaterializedLiveType,
  Schema,
} from "../schema";

export abstract class Storage {
  public abstract updateSchema(opts: Schema<any>): Promise<void>;

  public abstract findById<T extends LiveObjectAny>(
    resourceName: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined>;

  public abstract find<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>>;

  public abstract upsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>>;
}

export class InMemoryStorage extends Storage {
  private storage: Record<string, Record<string, any>> = {};

  public async updateSchema(opts: Schema<any>): Promise<void> {
    this.storage = Object.entries(opts).reduce(
      (acc, [_, entity]) => {
        acc[entity.name] = {};
        return acc;
      },
      {} as typeof this.storage
    );
  }

  public async findById<T extends LiveObjectAny>(
    resourceName: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined> {
    return this.storage[resourceName]?.[id] as MaterializedLiveType<T>;
  }

  public async find<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    // TODO implement where conditions

    return (this.storage[resourceName] ?? {}) as Record<
      string,
      MaterializedLiveType<T>
    >;
  }

  public async upsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>> {
    this.storage[resourceName] ??= {};

    this.storage[resourceName][resourceId] = value;

    return value;
  }
}

export class KyselyStorage extends Storage {
  private db: Kysely<{ [x: string]: Selectable<any> }>;

  public constructor(pool: PostgresPool) {
    super();
    this.db = new Kysely({
      dialect: new PostgresDialect({
        pool,
      }),
    });
  }

  private convertToMaterializedLiveType<T extends LiveObjectAny>(
    value: Record<string, any>,
    meta: Record<string, string> | undefined
  ): MaterializedLiveType<T> {
    return {
      value: Object.fromEntries(
        Object.entries(value).flatMap(([key, val]) => {
          if (!meta) return [];

          return [
            [
              key,
              {
                value: val,
                _meta: { timestamp: meta?.[key] },
              },
            ],
          ];
        })
      ) as unknown as MaterializedLiveType<T>["value"],
    } as MaterializedLiveType<T>;
  }

  public async updateSchema(opts: Schema<any>): Promise<void> {
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
              return storageFieldType.nullable ? c : c.notNull();
            })
            .execute()
            .catch((e) => {
              console.error("Error adding column", columnName, e);
              throw e;
            });
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

        if (storageFieldType.index) {
          let indexBuilder = this.db.schema
            .createIndex(`${resourceName}_${columnName}_index`)
            .on(resourceName)
            .column(columnName);

          if (storageFieldType.unique) {
            indexBuilder = indexBuilder.unique();
          }

          await indexBuilder.execute().catch((e) => {
            // this is expected to fail if the index already exists
          });
        }

        if (storageFieldType.references) {
          const [referenceTable, referenceColumn] =
            storageFieldType.references.split(".");
          await this.db.schema
            .alterTable(resourceName)
            .addForeignKeyConstraint(
              `${resourceName}_${columnName}_fk`,
              [columnName],
              referenceTable,
              [referenceColumn]
            )
            .execute()
            .catch((e) => {
              // this is expected to fail if the index already exists
            });
        }

        const columnMeta = tableMeta?.columns.find(
          (column) => column.name === columnName
        );

        if (!columnMeta) {
          await this.db.schema
            .alterTable(tableMetaName)
            .addColumn(columnName, "varchar")
            .execute();
        }
        if (storageFieldType.index) {
          let indexBuilder = this.db.schema
            .createIndex(`${tableMetaName}_${columnName}_index`)
            .on(tableMetaName)
            .column(columnName);

          if (storageFieldType.unique) {
            indexBuilder = indexBuilder.unique();
          }

          await indexBuilder.execute().catch((e) => {
            // this is expected to fail if the index already exists
          });

          await this.db.schema
            .alterTable(resourceName)
            .addForeignKeyConstraint(
              `${tableMetaName}_${columnName}_fk`,
              [columnName],
              resourceName,
              [columnName]
            )
            .execute()
            .catch((e) => {
              // this is expected to fail if the index already exists
            });
        }
      }
    }
  }

  public async findById<T extends LiveObjectAny>(
    resourceName: string,
    id: string
  ): Promise<MaterializedLiveType<T> | undefined> {
    const rawValue = await this.db
      .selectFrom(resourceName)
      .where("id", "=", id)
      .selectAll(resourceName)
      .executeTakeFirst();

    const metaValue = await this.db
      .selectFrom(`${resourceName}_meta`)
      .where("id", "=", id)
      .selectAll(`${resourceName}_meta`)
      .executeTakeFirst();

    if (!rawValue || !metaValue) return;

    return this.convertToMaterializedLiveType(rawValue, metaValue);
  }

  public async find<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    // TODO implement where conditions

    const rawValues: Record<string, Record<string, any>> = Object.fromEntries(
      (await this.db.selectFrom(resourceName).selectAll().execute()).map(
        (v) => {
          const { id, ...rest } = v;
          return [id, rest];
        }
      )
    );

    if (Object.keys(rawValues).length === 0) return {};

    const metaValues: Record<
      string,
      Record<string, string>
    > = Object.fromEntries(
      (
        await this.db
          .selectFrom(`${resourceName}_meta`)
          .selectAll()
          .where("id", "in", Object.keys(rawValues))
          .execute()
      ).map((v) => {
        const { id, ...rest } = v;
        return [id, rest];
      })
    );

    const value = Object.entries(rawValues).reduce(
      (acc, [id, value]) => {
        if (!metaValues[id]) return acc;

        acc[id] = this.convertToMaterializedLiveType(value, metaValues[id]);
        return acc;
      },
      {} as Record<string, MaterializedLiveType<T>>
    );

    return value;
  }

  public async upsert<T extends LiveObjectAny>(
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
}
