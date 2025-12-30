/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */

import type { Kysely, Selectable } from "kysely";
import { sql } from "kysely";
import type { LiveTypeAny, Schema } from "../../schema";
import type { Logger } from "../../utils";

const POSTGRES_DUPLICATE_COLUMN_ERROR_CODE = "42701";

type DeferredForeignKey = {
  tableName: string;
  columnName: string;
  references: string;
};

type ColumnToAdd = {
  name: string;
  storageFieldType: ReturnType<LiveTypeAny["getStorageFieldType"]>;
};

type TableInfo = {
  name: string;
  columns: Array<{ name: string; dataType: string }>;
};

function tableExists(tables: TableInfo[], tableName: string): boolean {
  return tables.some((t) => t.name === tableName);
}

function columnExists(
  table: TableInfo | undefined,
  columnName: string
): boolean {
  return table?.columns.some((col) => col.name === columnName) ?? false;
}

function referencedTableExists(
  tables: TableInfo[],
  references: string
): boolean {
  const [refTable] = references.split(".");
  return tableExists(tables, refTable);
}

function buildColumnDefinition(
  builder: any,
  storageFieldType: ReturnType<LiveTypeAny["getStorageFieldType"]>,
  tables: TableInfo[],
  skipForeignKey = false
): any {
  let columnBuilder = builder;

  if (storageFieldType.unique) {
    columnBuilder = columnBuilder.unique();
  }

  if (!storageFieldType.nullable) {
    columnBuilder = columnBuilder.notNull();
  }

  if (storageFieldType.primary) {
    columnBuilder = columnBuilder.primaryKey();
  }

  if (storageFieldType.default !== undefined) {
    columnBuilder = columnBuilder.defaultTo(storageFieldType.default);
  }

  if (
    !skipForeignKey &&
    storageFieldType.references &&
    referencedTableExists(tables, storageFieldType.references)
  ) {
    columnBuilder = columnBuilder.references(storageFieldType.references);
  }

  return columnBuilder;
}

function collectColumnsToAdd(
  entity: any,
  table: TableInfo | undefined,
  tables: TableInfo[],
  deferredForeignKeys: DeferredForeignKey[],
  tableName: string
): ColumnToAdd[] {
  const columnsToAdd: ColumnToAdd[] = [];

  for (const [columnName, column] of Object.entries(entity.fields)) {
    const tableColumn = table?.columns.find((col) => col.name === columnName);
    const storageFieldType = (column as LiveTypeAny).getStorageFieldType();

    if (!tableColumn) {
      columnsToAdd.push({ name: columnName, storageFieldType });

      if (
        storageFieldType.references &&
        !referencedTableExists(tables, storageFieldType.references)
      ) {
        deferredForeignKeys.push({
          tableName,
          columnName,
          references: storageFieldType.references,
        });
      }
    } else if (tableColumn.dataType !== storageFieldType.type) {
    }
  }

  return columnsToAdd;
}

async function createTableWithColumns(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  tableName: string,
  columnsToAdd: ColumnToAdd[],
  tables: TableInfo[],
  logger?: Logger
): Promise<void> {
  if (columnsToAdd.length === 0) return;

  let tableBuilder = db.schema.createTable(tableName);

  for (const { name, storageFieldType } of columnsToAdd) {
    tableBuilder = tableBuilder.addColumn(
      name,
      storageFieldType.type as any,
      (c) => buildColumnDefinition(c, storageFieldType, tables)
    );
  }

  await tableBuilder.execute().catch((e) => {
    if (e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
      logger?.error("Error creating table", tableName, e);
      throw e;
    }
  });
}

async function addColumnsToTable(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  tableName: string,
  columnsToAdd: ColumnToAdd[],
  tables: TableInfo[],
  deferredForeignKeys: DeferredForeignKey[],
  logger?: Logger
): Promise<void> {
  for (const { name, storageFieldType } of columnsToAdd) {
    const refTableExists = storageFieldType.references
      ? referencedTableExists(tables, storageFieldType.references)
      : false;

    await db.schema
      .alterTable(tableName)
      .addColumn(name, storageFieldType.type as any, (c) =>
        buildColumnDefinition(c, storageFieldType, tables, !refTableExists)
      )
      .execute()
      .catch((e) => {
        if (e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
          logger?.error("Error adding column", name, e);
          throw e;
        }
      });

    if (
      storageFieldType.references &&
      !refTableExists &&
      !deferredForeignKeys.some(
        (fk) => fk.tableName === tableName && fk.columnName === name
      )
    ) {
      deferredForeignKeys.push({
        tableName,
        columnName: name,
        references: storageFieldType.references,
      });
    }

    if (storageFieldType.index) {
      await db.schema
        .createIndex(`${tableName}_${name}_index`)
        .on(tableName)
        .column(name)
        .execute()
        .catch(() => {});
    }
  }
}

async function createOrUpdateMetaTable(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  resourceName: string,
  entity: any,
  tableMeta: TableInfo | undefined,
  tables: TableInfo[],
  logger?: Logger
): Promise<void> {
  const tableMetaName = `${resourceName}_meta`;

  const metaColumnsToAdd: ColumnToAdd[] = [];
  for (const [columnName, column] of Object.entries(entity.fields)) {
    const storageFieldType = (column as LiveTypeAny).getStorageFieldType();
    if (!columnExists(tableMeta, columnName)) {
      metaColumnsToAdd.push({ name: columnName, storageFieldType });
    }
  }

  if (!tableMeta && metaColumnsToAdd.length > 0) {
    let metaTableBuilder = db.schema.createTable(tableMetaName);

    for (const { name, storageFieldType } of metaColumnsToAdd) {
      metaTableBuilder = metaTableBuilder.addColumn(name, "varchar", (c) => {
        let builder = c;
        if (storageFieldType.primary) {
          builder = builder.primaryKey();
          if (tableExists(tables, resourceName)) {
            builder = builder.references(`${resourceName}.${name}`);
          }
        }
        return builder;
      });
    }

    await metaTableBuilder.execute().catch((e) => {
      if (e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
        logger?.error("Error creating meta table", tableMetaName, e);
        throw e;
      }
    });
  } else if (tableMeta) {
    for (const { name, storageFieldType } of metaColumnsToAdd) {
      await db.schema
        .alterTable(tableMetaName)
        .addColumn(name, "varchar", (c) => {
          let builder = c;
          if (storageFieldType.primary) {
            builder = builder.primaryKey();
            if (tableExists(tables, resourceName)) {
              builder = builder.references(`${resourceName}.${name}`);
            }
          }
          return builder;
        })
        .execute()
        .catch((e) => {
          if (e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
            logger?.error("Error adding meta column", name, e);
            throw e;
          }
        });
    }
  }
}

async function addForeignKeyConstraint(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  tableName: string,
  columnName: string,
  references: string,
  logger?: Logger
): Promise<void> {
  const [refTable, refColumn] = references.split(".");
  const constraintName = `${tableName}_${columnName}_fk`;

  try {
    await sql`
      ALTER TABLE ${sql.raw(tableName)}
      ADD CONSTRAINT ${sql.raw(constraintName)}
      FOREIGN KEY (${sql.raw(columnName)})
      REFERENCES ${sql.raw(refTable)} (${sql.raw(refColumn)})
    `.execute(db);
  } catch (e: any) {
    if (
      e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE &&
      !e.message?.includes("already exists") &&
      !e.message?.includes("duplicate")
    ) {
      logger?.warn(
        "Could not add foreign key constraint",
        tableName,
        columnName,
        references,
        e
      );
    }
  }
}

async function addDeferredForeignKeys(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  deferredForeignKeys: DeferredForeignKey[],
  tables: TableInfo[],
  logger?: Logger
): Promise<void> {
  for (const { tableName, columnName, references } of deferredForeignKeys) {
    const table = tables.find((t) => t.name === tableName);
    const column = table?.columns.find((col) => col.name === columnName);
    const [refTable] = references.split(".");

    if (table && column && tableExists(tables, refTable)) {
      await addForeignKeyConstraint(
        db,
        tableName,
        columnName,
        references,
        logger
      );
    }
  }
}

async function addMetaTableForeignKeys(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  opts: Schema<any>,
  tables: TableInfo[],
  logger?: Logger
): Promise<void> {
  for (const [resourceName, entity] of Object.entries(opts)) {
    const tableMetaName = `${resourceName}_meta`;
    const tableMeta = tables.find((t) => t.name === tableMetaName);

    if (!tableMeta) continue;

    for (const [columnName, column] of Object.entries(entity.fields)) {
      const storageFieldType = (column as LiveTypeAny).getStorageFieldType();
      const columnMeta = tableMeta.columns.find(
        (col) => col.name === columnName
      );

      if (
        storageFieldType.primary &&
        columnMeta &&
        tableExists(tables, resourceName)
      ) {
        await addForeignKeyConstraint(
          db,
          tableMetaName,
          columnName,
          `${resourceName}.${columnName}`,
          logger
        );
      }
    }
  }
}

export async function initializeSchema(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  opts: Schema<any>,
  logger?: Logger
): Promise<void> {
  const tables = await db.introspection.getTables();
  const deferredForeignKeys: DeferredForeignKey[] = [];

  for (const [resourceName, entity] of Object.entries(opts)) {
    const table = tables.find((t) => t.name === resourceName);
    const tableMeta = tables.find((t) => t.name === `${resourceName}_meta`);

    const columnsToAdd = collectColumnsToAdd(
      entity,
      table,
      tables,
      deferredForeignKeys,
      resourceName
    );

    if (table) {
      for (const [columnName, column] of Object.entries(entity.fields)) {
        const tableColumn = table.columns.find(
          (col) => col.name === columnName
        );
        const storageFieldType = (column as LiveTypeAny).getStorageFieldType();

        if (tableColumn && tableColumn.dataType !== storageFieldType.type) {
          logger?.warn(
            "Column type mismatch:",
            columnName,
            "expected to have type:",
            storageFieldType.type,
            "but has type:",
            tableColumn.dataType
          );
        }
      }
    }

    if (!table && columnsToAdd.length > 0) {
      await createTableWithColumns(
        db,
        resourceName,
        columnsToAdd,
        tables,
        logger
      );
    } else if (table) {
      await addColumnsToTable(
        db,
        resourceName,
        columnsToAdd,
        tables,
        deferredForeignKeys,
        logger
      );
    }

    await createOrUpdateMetaTable(
      db,
      resourceName,
      entity,
      tableMeta,
      tables,
      logger
    );
  }

  const updatedTables = await db.introspection.getTables();

  await addDeferredForeignKeys(db, deferredForeignKeys, updatedTables, logger);

  await addMetaTableForeignKeys(db, opts, updatedTables, logger);
}
