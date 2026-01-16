/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */

import type { Kysely, Selectable } from "kysely";
import { sql } from "kysely";
import type { LiveTypeAny, Schema, StorageFieldType } from "../../schema";
import type { Logger } from "../../utils";
import { type SupportedDialect, detectDialect } from "./dialect-helpers";

const POSTGRES_DUPLICATE_COLUMN_ERROR_CODE = "42701";

/**
 * Checks if an error is a duplicate/already exists error.
 * Handles both PostgreSQL error codes and generic error messages.
 */
function isDuplicateError(error: any): boolean {
  if (error.code === POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
    return true;
  }
  const message = error.message?.toLowerCase() || "";
  return (
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("already defined")
  );
}

function resolveColumnType(
  storageFieldType: StorageFieldType,
  dialect: SupportedDialect
): string {
  const { type, enumValues, enumName } = storageFieldType;

  if (enumValues && enumValues.length > 0) {
    if (dialect === "postgres" && enumName) {
      return enumName;
    }
    return "varchar";
  }

  if (type === "jsonb" || type === "json") {
    switch (dialect) {
      case "postgres":
        return "jsonb";
      case "mysql":
        return "json";
      case "sqlite":
        return "text";
    }
  }

  return type;
}

async function createEnumTypesIfNeeded(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  schema: Schema<any>,
  dialect: SupportedDialect,
  logger?: Logger
): Promise<void> {
  if (dialect !== "postgres") return;

  const enumTypes = new Map<
    string,
    { name: string; values: readonly string[] }
  >();

  for (const entity of Object.values(schema)) {
    for (const field of Object.values(entity.fields)) {
      const fieldType = (field as LiveTypeAny).getStorageFieldType();
      if (fieldType.enumValues && fieldType.enumName) {
        enumTypes.set(fieldType.enumName, {
          name: fieldType.enumName,
          values: fieldType.enumValues,
        });
      }
    }
  }

  for (const enumType of Array.from(enumTypes.values())) {
    const { name, values } = enumType;
    try {
      const valuesList = values.map((v: string) => `'${v}'`).join(", ");
      await sql`
        DO $$ BEGIN
          CREATE TYPE ${sql.id(name)} AS ENUM (${sql.raw(valuesList)});
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `.execute(db);
    } catch (e) {
      logger?.warn("Could not create enum type", name, e);
    }
  }
}

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

function isEnumColumn(
  storageFieldType: StorageFieldType,
  dialect: SupportedDialect
): boolean {
  return (
    dialect === "postgres" &&
    !!storageFieldType.enumValues &&
    storageFieldType.enumValues.length > 0 &&
    !!storageFieldType.enumName
  );
}

async function createTableWithColumns(
  db: Kysely<{ [x: string]: Selectable<any> }>,
  tableName: string,
  columnsToAdd: ColumnToAdd[],
  tables: TableInfo[],
  dialect: SupportedDialect,
  logger?: Logger
): Promise<void> {
  if (columnsToAdd.length === 0) return;

  let tableBuilder = db.schema.createTable(tableName);

  for (const { name, storageFieldType } of columnsToAdd) {
    // For Postgres enum columns, use sql.raw() since Kysely doesn't recognize custom type names
    if (isEnumColumn(storageFieldType, dialect)) {
      tableBuilder = tableBuilder.addColumn(
        name,
        sql.raw(storageFieldType.enumName!) as any,
        (c) => buildColumnDefinition(c, storageFieldType, tables)
      );
    } else {
      const columnType = resolveColumnType(storageFieldType, dialect);
      tableBuilder = tableBuilder.addColumn(name, columnType as any, (c) =>
        buildColumnDefinition(c, storageFieldType, tables)
      );
    }
  }

  await tableBuilder.execute().catch((e) => {
    if (!isDuplicateError(e)) {
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
  dialect: SupportedDialect,
  logger?: Logger
): Promise<void> {
  for (const { name, storageFieldType } of columnsToAdd) {
    const refTableExists = storageFieldType.references
      ? referencedTableExists(tables, storageFieldType.references)
      : false;

    // For Postgres enum columns, use sql.raw() since Kysely doesn't recognize custom type names
    const columnType = isEnumColumn(storageFieldType, dialect)
      ? sql.raw(storageFieldType.enumName!)
      : resolveColumnType(storageFieldType, dialect);

    await db.schema
      .alterTable(tableName)
      .addColumn(name, columnType as any, (c) =>
        buildColumnDefinition(c, storageFieldType, tables, !refTableExists)
      )
      .execute()
      .catch((e) => {
        if (!isDuplicateError(e)) {
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
      if (!isDuplicateError(e)) {
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
          if (!isDuplicateError(e)) {
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
      ALTER TABLE ${sql.id(tableName)}
      ADD CONSTRAINT ${sql.id(constraintName)}
      FOREIGN KEY (${sql.id(columnName)})
      REFERENCES ${sql.id(refTable)} (${sql.id(refColumn)})
    `.execute(db);
  } catch (e: any) {
    if (!isDuplicateError(e)) {
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
  const dialect = detectDialect(db);
  const tables = await db.introspection.getTables();
  const deferredForeignKeys: DeferredForeignKey[] = [];

  await createEnumTypesIfNeeded(db, opts, dialect, logger);

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
        const expectedType = resolveColumnType(storageFieldType, dialect);

        if (tableColumn && tableColumn.dataType !== expectedType) {
          logger?.warn(
            "Column type mismatch:",
            columnName,
            "expected to have type:",
            expectedType,
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
        dialect,
        logger
      );
    } else if (table) {
      await addColumnsToTable(
        db,
        resourceName,
        columnsToAdd,
        tables,
        deferredForeignKeys,
        dialect,
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
