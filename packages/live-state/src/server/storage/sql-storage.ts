/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */
import {
  type ControlledTransaction,
  Kysely,
  PostgresDialect,
  type PostgresPool,
  type Selectable,
} from "kysely";
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
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../../schema";
import type { Logger } from "../../utils";
import type { Server } from "..";
import {
  type DialectHelpers,
  detectDialect,
  getDialectHelpers,
} from "./dialect-helpers";
import { Storage } from "./interface";
import { initializeSchema } from "./schema-init";
import { applyInclude, applyWhere } from "./sql-utils";

export class SQLStorage extends Storage {
  private readonly db: Kysely<{ [x: string]: Selectable<any> }>;
  private readonly dialectHelpers: DialectHelpers;
  private schema?: Schema<any>;
  private logger?: Logger;
  private server?: Server<any>;
  private mutationStack: Array<{
    mutation: DefaultMutation;
    entityData: MaterializedLiveType<any>;
  }> = [];

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

    this.dialectHelpers = getDialectHelpers(this.db);
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

    await initializeSchema(this.db, opts, logger);
  }

  private selectMetaColumns(
    eb: any,
    resourceName: string,
    metaTableName: string
  ): any {
    const dialect = detectDialect(this.db);
    const entity = this.schema?.[resourceName];

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

  /** @internal */
  public async rawFindById<T extends LiveObjectAny>(
    resourceName: string,
    id: string,
    include?: IncludeClause<T>
  ): Promise<MaterializedLiveType<T> | undefined> {
    if (!this.schema) throw new Error("Schema not initialized");

    const metaTableName = `${resourceName}_meta`;

    let query = await this.db
      .selectFrom(resourceName)
      .where("id", "=", id)
      .selectAll(resourceName)
      .select((eb) =>
        this.dialectHelpers
          .jsonObjectFrom(
            this.selectMetaColumns(eb, resourceName, metaTableName).whereRef(
              `${metaTableName}.id`,
              "=",
              `${resourceName}.id`
            )
          )
          .as("_meta")
      );

    query = applyInclude(
      this.schema,
      resourceName,
      query,
      include,
      this.dialectHelpers,
      this.db
    );

    const rawValue = await query.executeTakeFirst();

    if (!rawValue) return;

    const parsedValue = this.parseRelationalJsonStrings(rawValue, resourceName);
    return this.convertToMaterializedLiveType(parsedValue);
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
  public async get(query: RawQueryRequest): Promise<any[]> {
    if (!this.schema) throw new Error("Schema not initialized");

    const { resource: resourceName, where, include, limit, sort } = query;
    const metaTableName = `${resourceName}_meta`;

    let queryBuilder = this.db
      .selectFrom(resourceName)
      .selectAll(resourceName)
      .select((eb) =>
        this.dialectHelpers
          .jsonObjectFrom(
            this.selectMetaColumns(eb, resourceName, metaTableName).whereRef(
              `${metaTableName}.id`,
              "=",
              `${resourceName}.id`
            )
          )
          .as("_meta")
      );

    queryBuilder = applyWhere(this.schema, resourceName, queryBuilder, where);

    queryBuilder = applyInclude(
      this.schema,
      resourceName,
      queryBuilder,
      include,
      this.dialectHelpers,
      this.db
    );

    if (limit !== undefined) {
      queryBuilder = queryBuilder.limit(limit);
    }

    if (sort !== undefined) {
      sort.forEach((s) => {
        queryBuilder = queryBuilder.orderBy(s.key, s.direction);
      });
    }

    const rawResult = await queryBuilder.execute();

    if (rawResult.length === 0) return [];

    return rawResult.map((v) => {
      const parsedValue = this.parseRelationalJsonStrings(v, resourceName);
      return this.convertToMaterializedLiveType(parsedValue);
    });
  }

  public async find<T extends LiveObjectAny>(
    resource: T,
    options?: {
      where?: WhereClause<T>;
      include?: IncludeClause<T>;
      limit?: number;
      sort?: { key: string; direction: "asc" | "desc" }[];
    }
  ): Promise<InferLiveObject<T>[]> {
    const materializedResults = await this.get({
      resource: resource.name,
      where: options?.where,
      include: options?.include,
      limit: options?.limit,
      sort: options?.sort,
    });

    return materializedResults.map(
      (value) => inferValue(value) as InferLiveObject<T>
    );
  }

  /** @internal */
  public async rawInsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>,
    mutationId?: string,
    context?: Record<string, any>
  ): Promise<MaterializedLiveType<T>> {
    const hooks = this.server?.router?.getHooks(resourceName);

    let processedValue = value;

    if (hooks?.beforeInsert) {
      const hookResult = await hooks.beforeInsert({
        ctx: context,
        value: processedValue,
        db: this,
      });

      if (hookResult) {
        processedValue = hookResult as MaterializedLiveType<T>;
      }
    }

    const values: Record<string, any> = {};
    const metaValues: Record<string, string> = {};

    for (const [key, val] of Object.entries(processedValue.value)) {
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
      processedValue,
      mutationId
    );

    if (mutation) {
      this.trackMutation(mutation, processedValue);
    }

    if (hooks?.afterInsert) {
      await hooks.afterInsert({
        ctx: context,
        value: processedValue,
        db: this,
      });
    }

    return processedValue;
  }

  /** @internal */
  public async rawUpdate<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>,
    mutationId?: string,
    context?: Record<string, any>
  ): Promise<MaterializedLiveType<T>> {
    const hooks = this.server?.router?.getHooks(resourceName);

    let previousValue: MaterializedLiveType<T> | undefined;
    if (hooks?.beforeUpdate || hooks?.afterUpdate) {
      previousValue = await this.rawFindById<T>(resourceName, resourceId);
    }

    let processedValue = value;
    if (hooks?.beforeUpdate) {
      const hookResult = await hooks.beforeUpdate({
        ctx: context,
        value: processedValue,
        previousValue,
        db: this,
      });

      if (hookResult) {
        processedValue = hookResult as MaterializedLiveType<T>;
      }
    }

    const values: Record<string, any> = {};
    const metaValues: Record<string, string> = {};

    for (const [key, val] of Object.entries(processedValue.value)) {
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
      processedValue,
      mutationId
    );

    // TODO investigate using returning queries
    if (mutation) {
      const completeEntity = await this.rawFindById(resourceName, resourceId);
      if (completeEntity) {
        this.trackMutation(mutation, completeEntity);
      }
    }

    if (hooks?.afterUpdate) {
      const updatedValue = await this.rawFindById<T>(resourceName, resourceId);
      if (updatedValue) {
        await hooks.afterUpdate({
          ctx: context,
          value: updatedValue,
          previousValue,
          db: this,
        });
      }
    }

    return processedValue;
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
      const nestedStack: Array<{
        mutation: DefaultMutation;
        entityData: MaterializedLiveType<any>;
      }> = [];
      this.mutationStack = nestedStack;

      const trx = await (this.db as ControlledTransaction<any>)
        .savepoint(savepointName)
        .execute();

      let savepointReleased = false;
      let savepointRolledBack = false;

      try {
        return await fn({
          trx: this,
          commit: async () => {
            await trx.releaseSavepoint(savepointName).execute();
            savepointReleased = true;
            parentStack.push(...nestedStack);
          },
          rollback: async () => {
            await trx.rollbackToSavepoint(savepointName).execute();
            savepointRolledBack = true;
            nestedStack.length = 0;
          },
        }).then((v) => {
          if (
            trx.isCommitted ||
            trx.isRolledBack ||
            savepointReleased ||
            savepointRolledBack
          ) {
            return v;
          }

          return trx
            .releaseSavepoint(savepointName)
            .execute()
            .then(() => {
              parentStack.push(...nestedStack);
              return v;
            });
        });
      } catch (e) {
        if (!savepointRolledBack) {
          await trx
            .rollbackToSavepoint(savepointName)
            .execute()
            .catch(() => {
              // Ignoring this error because it's already rolled back
            });
        }
        nestedStack.length = 0;
        throw e;
      } finally {
        this.mutationStack = parentStack;
      }
    }

    const transactionStack: Array<{
      mutation: DefaultMutation;
      entityData: MaterializedLiveType<any>;
    }> = [];
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
      (transactionStorage as any).mutationStack = transactionStack;

      return await fn({
        trx: transactionStorage,
        commit: async () => {
          await trx.commit().execute();
          this.notifyMutations(transactionStack);
        },
        rollback: async () => {
          await trx.rollback().execute();
          transactionStack.length = 0;
        },
      }).then((v) => {
        if (trx.isCommitted || trx.isRolledBack) return v;

        return trx
          .commit()
          .execute()
          .then(() => {
            this.notifyMutations(transactionStack);
            return v;
          });
      });
    } catch (e) {
      await trx.rollback().execute();
      transactionStack.length = 0;
      throw e;
    } finally {
      this.mutationStack = previousStack;
    }
  }

  /**
   * Provides direct access to the underlying Kysely database instance.
   *
   * ⚠️ Warning: Direct database operations bypass mutation tracking and
   * subscriber notifications. Use this only when you need to execute
   * queries not supported by the Storage API.
   *
   * @returns The Kysely database instance
   */
  public get internalDB() {
    return this.db;
  }

  private isRelationalField(resourceName: string, fieldName: string): boolean {
    if (!this.schema) return false;
    const resourceSchema = this.schema[resourceName];
    return !!resourceSchema?.relations?.[fieldName];
  }

  private parseRelationalJsonStrings(value: any, resourceName: string): any {
    const dialect = detectDialect(this.db);

    if (dialect !== "sqlite") {
      return value;
    }

    if (typeof value !== "object" || value === null || value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) =>
        this.parseRelationalJsonStrings(item, resourceName)
      );
    }

    const parsed: Record<string, any> = {};

    for (const [key, val] of Object.entries(value)) {
      if (key === "_meta" && typeof val === "string") {
        if (
          (val.startsWith("{") && val.endsWith("}")) ||
          (val.startsWith("[") && val.endsWith("]"))
        ) {
          try {
            parsed[key] = JSON.parse(val);
          } catch {
            parsed[key] = val;
          }
        } else {
          parsed[key] = val;
        }
      } else if (this.isRelationalField(resourceName, key)) {
        if (typeof val === "string") {
          if (
            (val.startsWith("{") && val.endsWith("}")) ||
            (val.startsWith("[") && val.endsWith("]"))
          ) {
            try {
              const jsonParsed = JSON.parse(val);
              if (this.schema) {
                const resourceSchema = this.schema[resourceName];
                const relation = resourceSchema?.relations?.[key];
                if (relation) {
                  const nestedResourceName = relation.entity.name;
                  parsed[key] = this.parseRelationalJsonStrings(
                    jsonParsed,
                    nestedResourceName
                  );
                } else {
                  parsed[key] = jsonParsed;
                }
              } else {
                parsed[key] = jsonParsed;
              }
            } catch {
              parsed[key] = val;
            }
          } else {
            parsed[key] = val;
          }
        } else if (
          typeof val === "object" &&
          val !== null &&
          !Array.isArray(val)
        ) {
          if (this.schema) {
            const resourceSchema = this.schema[resourceName];
            const relation = resourceSchema?.relations?.[key];
            if (relation) {
              const nestedResourceName = relation.entity.name;
              parsed[key] = this.parseRelationalJsonStrings(
                val,
                nestedResourceName
              );
            } else {
              parsed[key] = val;
            }
          } else {
            parsed[key] = val;
          }
        } else if (Array.isArray(val)) {
          parsed[key] = val.map((item) => {
            if (typeof item === "string") {
              try {
                const jsonParsed = JSON.parse(item);
                if (this.schema) {
                  const resourceSchema = this.schema[resourceName];
                  const relation = resourceSchema?.relations?.[key];
                  if (relation) {
                    const nestedResourceName = relation.entity.name;
                    return this.parseRelationalJsonStrings(
                      jsonParsed,
                      nestedResourceName
                    );
                  }
                }
                return jsonParsed;
              } catch {
                return item;
              }
            }
            if (typeof item === "object" && item !== null) {
              if (this.schema) {
                const resourceSchema = this.schema[resourceName];
                const relation = resourceSchema?.relations?.[key];
                if (relation) {
                  const nestedResourceName = relation.entity.name;
                  return this.parseRelationalJsonStrings(
                    item,
                    nestedResourceName
                  );
                }
              }
            }
            return item;
          });
        } else {
          parsed[key] = val;
        }
      } else {
        parsed[key] = val;
      }
    }

    return parsed;
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
    value: MaterializedLiveType<T>,
    mutationId?: string
  ): DefaultMutation | null {
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
      id: mutationId ?? generateId(),
      type: "MUTATE",
      resource: resourceName,
      resourceId,
      procedure,
      payload,
    };
  }

  private trackMutation(
    mutation: DefaultMutation,
    entityData: MaterializedLiveType<any>
  ): void {
    if (this.db.isTransaction) {
      this.mutationStack.push({ mutation, entityData });
    } else {
      this.notifyMutations([mutation], entityData);
    }
  }

  private notifyMutations(
    mutations: DefaultMutation[],
    entityData: MaterializedLiveType<any>
  ): void;
  private notifyMutations(
    mutationEntries: Array<{
      mutation: DefaultMutation;
      entityData: MaterializedLiveType<any>;
    }>
  ): void;
  private notifyMutations(
    mutationsOrEntries:
      | DefaultMutation[]
      | Array<{
          mutation: DefaultMutation;
          entityData: MaterializedLiveType<any>;
        }>,
    entityData?: MaterializedLiveType<any>
  ): void {
    if (!this.server) return;

    if (entityData !== undefined) {
      const mutations = mutationsOrEntries as DefaultMutation[];
      for (const mutation of mutations) {
        this.server.notifySubscribers(mutation, entityData);
      }
    } else {
      const entries = mutationsOrEntries as Array<{
        mutation: DefaultMutation;
        entityData: MaterializedLiveType<any>;
      }>;
      for (const { mutation, entityData: data } of entries) {
        this.server.notifySubscribers(mutation, data);
      }
    }
  }
}
