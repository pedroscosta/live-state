/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
import {
  type ControlledTransaction,
  Kysely,
  PostgresDialect,
  type PostgresPool,
  type Selectable,
} from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../../core/schemas/core-protocol";
import { generateId } from "../../core/utils";
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
import type { Logger } from "../../utils";
import type { Server } from "..";
import { Storage } from "./interface";
import { applyInclude, applyWhere } from "./sql-utils";

const POSTGRES_DUPLICATE_COLUMN_ERROR_CODE = "42701";

export class SQLStorage extends Storage {
  private db: Kysely<{ [x: string]: Selectable<any> }>;
  private schema?: Schema<any>;
  private logger?: Logger;
  private server?: Server<any>;
  private mutationStack: DefaultMutation[] = [];

  public constructor(pool: PostgresPool);
  /** @internal */
  public constructor(
    db: Kysely<{ [x: string]: Selectable<any> }>,
    schema: Schema<any>,
    logger?: Logger,
    server?: Server<any>
  );
  public constructor(
    poolOrDb: PostgresPool | Kysely<{ [x: string]: Selectable<any> }>,
    schema?: Schema<any>,
    logger?: Logger,
    server?: Server<any>
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
    this.logger = logger;
    this.server = server;

    this.rawInsert = this.rawInsert.bind(this);
    this.rawUpdate = this.rawUpdate.bind(this);
  }

  /** @internal */
  public async init(
    opts: Schema<any>,
    logger?: Logger,
    server?: Server<any>
  ): Promise<void> {
    this.schema = opts;
    this.logger = logger;
    this.server = server;

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
              if (e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
                this.logger?.error("Error adding column", columnName, e);
                throw e;
              }
            });

          if (storageFieldType.index) {
            await this.db.schema
              .createIndex(`${resourceName}_${columnName}_index`)
              .on(resourceName)
              .column(columnName)
              .execute()
              .catch(() => {});
          }
        } else if (tableColumn.dataType !== storageFieldType.type) {
          this.logger?.warn(
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
            .execute()
            .catch((e) => {
              if (e.code !== POSTGRES_DUPLICATE_COLUMN_ERROR_CODE) {
                this.logger?.error("Error adding meta column", columnName, e);
                throw e;
              }
            });
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
    queryRequest: RawQueryRequest
  ): Promise<Record<string, MaterializedLiveType<T>>> {
    if (!this.schema) throw new Error("Schema not initialized");

    const {
      resource: resourceName,
      where,
      include,
      limit,
      sort,
    } = queryRequest;

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

    query = applyInclude(this.schema, resourceName, query, include);

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    if (sort !== undefined) {
      sort.forEach((s) => {
        query = query.orderBy(s.key, s.direction);
      });
    }

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

  // TODO use query builder
  public async find<T extends LiveObjectAny>(
    resource: T,
    options?: {
      where?: WhereClause<T>;
      include?: IncludeClause<T>;
      limit?: number;
      sort?: { key: string; direction: "asc" | "desc" }[];
    }
  ): Promise<Record<string, InferLiveObject<T>>> {
    const rawResult = await this.rawFind({
      resource: resource.name,
      where: options?.where,
      include: options?.include,
      limit: options?.limit,
      sort: options?.sort,
    });

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

    const mutation = this.buildMutation(
      resourceName,
      resourceId,
      "INSERT",
      value
    );

    if (mutation) {
      this.trackMutation(mutation);
    }

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

    const mutation = this.buildMutation(
      resourceName,
      resourceId,
      "UPDATE",
      value
    );

    if (mutation) {
      this.trackMutation(mutation);
    }

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
      const parentStack = this.mutationStack;
      const nestedStack: DefaultMutation[] = [];
      this.mutationStack = nestedStack;

      const trx = await (this.db as ControlledTransaction<any>)
        .savepoint(savepointName)
        .execute();

      try {
        return await fn({
          trx: this,
          commit: async () => {
            await trx.releaseSavepoint(savepointName).execute();
            // Push nested mutations to parent stack
            parentStack.push(...nestedStack);
          },
          rollback: async () => {
            await trx.rollbackToSavepoint(savepointName).execute();
            // Clear nested mutations on rollback
            nestedStack.length = 0;
          },
        }).then((v) => {
          if (trx.isCommitted || trx.isRolledBack) return v;

          return trx
            .releaseSavepoint(savepointName)
            .execute()
            .then(() => {
              // Push nested mutations to parent stack
              parentStack.push(...nestedStack);
              return v;
            });
        });
      } catch (e) {
        await trx
          .rollbackToSavepoint(savepointName)
          .execute()
          .catch(() => {
            // Ignoring this error because it's already rolled back
          });
        // Clear nested mutations on rollback
        nestedStack.length = 0;
        throw e;
      } finally {
        // Restore parent stack
        this.mutationStack = parentStack;
      }
    }

    const transactionStack: DefaultMutation[] = [];
    const previousStack = this.mutationStack;
    this.mutationStack = transactionStack;

    const trx = await this.db.startTransaction().execute();

    try {
      const transactionStorage = new SQLStorage(
        trx as typeof this.db,
        this.schema,
        this.logger,
        this.server
      );
      // Share the mutation stack with the transaction storage instance
      (transactionStorage as any).mutationStack = transactionStack;

      return await fn({
        trx: transactionStorage,
        commit: async () => {
          await trx.commit().execute();
          // Notify all mutations when transaction commits
          this.notifyMutations(transactionStack);
        },
        rollback: async () => {
          await trx.rollback().execute();
          // Clear mutations on rollback
          transactionStack.length = 0;
        },
      }).then((v) => {
        if (trx.isCommitted || trx.isRolledBack) return v;

        return trx
          .commit()
          .execute()
          .then(() => {
            // Notify all mutations when transaction commits
            this.notifyMutations(transactionStack);
            return v;
          });
      });
    } catch (e) {
      await trx.rollback().execute();
      // Clear mutations on rollback
      transactionStack.length = 0;
      throw e;
    } finally {
      // Restore previous stack
      this.mutationStack = previousStack;
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

  private buildMutation<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    procedure: "INSERT" | "UPDATE",
    value: MaterializedLiveType<T>
  ): DefaultMutation | null {
    // Extract payload from MaterializedLiveType
    const payload: Record<
      string,
      { value: any; _meta?: { timestamp: string } }
    > = {};

    for (const [key, val] of Object.entries(value.value)) {
      if (key === "id") continue;

      const metaVal = val._meta?.timestamp;
      if (!metaVal) continue;

      payload[key] = {
        value: val.value,
        _meta: { timestamp: metaVal },
      };
    }

    if (Object.keys(payload).length === 0) return null;

    return {
      id: generateId(),
      type: "MUTATE",
      resource: resourceName,
      resourceId,
      procedure,
      payload,
    };
  }

  private trackMutation(mutation: DefaultMutation): void {
    // If we're in a transaction, add to stack
    if (this.db.isTransaction) {
      this.mutationStack.push(mutation);
    } else {
      // If not in transaction, notify immediately
      this.notifyMutations([mutation]);
    }
  }

  private notifyMutations(mutations: DefaultMutation[]): void {
    if (!this.server || mutations.length === 0) return;

    for (const mutation of mutations) {
      this.server.notifySubscribers(mutation);
    }
  }
}
