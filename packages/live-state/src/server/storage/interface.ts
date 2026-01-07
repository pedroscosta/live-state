/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */

import type { DataSource } from "../../core/query-engine/types";
import type { RawQueryRequest } from "../../core/schemas/core-protocol";
import type { PromiseOrSync } from "../../core/utils";
import {
  type IncludeClause,
  type InferInsert,
  type InferLiveObject,
  type InferUpdate,
  inferValue,
  type LiveObjectAny,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../../schema";
import type { Logger, Simplify } from "../../utils";
import type { Server } from "..";

export abstract class Storage implements DataSource {
  /** @internal */
  public abstract init(
    opts: Schema<any>,
    logger?: Logger,
    server?: Server<any>
  ): Promise<void>;

  /** @internal */
  public abstract rawFindById<T extends LiveObjectAny>(
    resourceName: string,
    id: string,
    include?: IncludeClause<T>
  ): Promise<MaterializedLiveType<T> | undefined>;

  public abstract findOne<
    T extends LiveObjectAny,
    TInclude extends IncludeClause<T> | undefined = undefined,
  >(
    resource: T,
    id: string,
    options?: {
      include?: TInclude;
    }
  ): Promise<InferLiveObject<T, TInclude> | undefined>;

  /** @internal */
  public abstract get(query: RawQueryRequest): PromiseOrSync<any[]>;

  public abstract find<
    T extends LiveObjectAny,
    TInclude extends IncludeClause<T> | undefined = undefined,
  >(
    resource: T,
    options?: {
      where?: WhereClause<T>;
      include?: TInclude;
      limit?: number;
      sort?: { key: string; direction: "asc" | "desc" }[];
    }
  ): Promise<InferLiveObject<T, TInclude>[]>;

  /** @internal */
  public abstract rawInsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>,
    mutationId?: string,
    context?: Record<string, any>
  ): Promise<MaterializedLiveType<T>>;

  /** @internal */
  public abstract rawUpdate<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>,
    mutationId?: string,
    context?: Record<string, any>
  ): Promise<MaterializedLiveType<T>>;

  public async insert<T extends LiveObjectAny>(
    resource: T,
    value: Simplify<InferInsert<T>>
  ): Promise<InferLiveObject<T>> {
    const now = new Date().toISOString();

    return inferValue(
      await this.rawInsert(
        resource.name,
        (value as any).id as string,
        {
          value: Object.fromEntries(
            Object.entries(value).map(([k, v]) => [
              k,
              {
                value: v,
                _meta: {
                  timestamp: now,
                },
              },
            ])
          ),
        } as unknown as MaterializedLiveType<T>
      )
    ) as InferLiveObject<T>;
  }

  public async update<T extends LiveObjectAny>(
    resource: T,
    resourceId: string,
    value: InferUpdate<T>
  ): Promise<Partial<InferLiveObject<T>>> {
    const now = new Date().toISOString();

    // biome-ignore lint/correctness/noUnusedVariables: id is ignored on purpose
    const { id, ...rest } = value as any;

    return inferValue(
      await this.rawUpdate(resource.name, resourceId, {
        value: Object.fromEntries(
          Object.entries(rest).map(([k, v]) => [
            k,
            {
              value: v,
              _meta: {
                timestamp: now,
              },
            },
          ])
        ),
      } as unknown as MaterializedLiveType<T>)
    ) as Partial<InferLiveObject<T>>;
  }

  public abstract transaction<T>(
    fn: (opts: {
      trx: Storage;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
    }) => Promise<T>
  ): Promise<T>;
}
