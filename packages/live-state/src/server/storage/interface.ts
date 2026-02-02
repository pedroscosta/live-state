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

/** @internal */
export type RawMutationResult<T extends LiveObjectAny> = {
  data: MaterializedLiveType<T>;
  acceptedValues: Record<string, any> | null;
};

export abstract class Storage implements DataSource {
  /** @internal */
  protected _mutationTimestamp?: string;

  /** @internal */
  public _setMutationTimestamp(timestamp: string | undefined): Storage {
    const nextStorage = this._clone();
    nextStorage._mutationTimestamp = timestamp;
    return nextStorage;
  }

  /** @internal */
  protected _getTimestamp(): string {
    return this._mutationTimestamp ?? new Date().toISOString();
  }

  /** @internal */
  protected _clone(): this {
    return Object.assign(
      Object.create(Object.getPrototypeOf(this)),
      this,
    );
  }

  /** @internal */
  public abstract init(
    opts: Schema<any>,
    logger?: Logger,
    server?: Server<any>,
  ): Promise<void>;

  /** @internal */
  public abstract rawFindById<T extends LiveObjectAny>(
    resourceName: string,
    id: string,
    include?: IncludeClause<T>,
  ): Promise<MaterializedLiveType<T> | undefined>;

  /**
   * @deprecated Use db.[collection].one(id).get() instead
   */
  public abstract findOne<
    T extends LiveObjectAny,
    TInclude extends IncludeClause<T> | undefined = undefined,
  >(
    resource: T,
    id: string,
    options?: {
      include?: TInclude;
    },
  ): Promise<InferLiveObject<T, TInclude> | undefined>;

  /** @internal */
  public abstract get(query: RawQueryRequest): PromiseOrSync<any[]>;

  /**
   * @deprecated Use db.[collection].where({...}).get() instead
   */
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
    },
  ): Promise<InferLiveObject<T, TInclude>[]>;

  /** @internal */
  public abstract rawInsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>,
    mutationId?: string,
    context?: Record<string, any>,
  ): Promise<RawMutationResult<T>>;

  /** @internal */
  public abstract rawUpdate<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>,
    mutationId?: string,
    context?: Record<string, any>,
  ): Promise<RawMutationResult<T>>;

  /**
   * @deprecated Use db.[collection].insert({...}) instead
   */
  public async insert<T extends LiveObjectAny>(
    resource: T,
    value: Simplify<InferInsert<T>>,
  ): Promise<InferLiveObject<T>> {
    const now = this._getTimestamp();

    const result = await this.rawInsert(
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
          ]),
        ),
      } as unknown as MaterializedLiveType<T>,
    );
    return inferValue(result.data) as InferLiveObject<T>;
  }

  /**
   * @deprecated Use db.[collection].update(id, {...}) instead
   */
  public async update<T extends LiveObjectAny>(
    resource: T,
    resourceId: string,
    value: InferUpdate<T>,
  ): Promise<Partial<InferLiveObject<T>>> {
    const now = this._getTimestamp();

    // biome-ignore lint/correctness/noUnusedVariables: id is ignored on purpose
    const { id, ...rest } = value as any;

    const result = await this.rawUpdate(resource.name, resourceId, {
      value: Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [
          k,
          {
            value: v,
            _meta: {
              timestamp: now,
            },
          },
        ]),
      ),
    } as unknown as MaterializedLiveType<T>);

    const inferred = inferValue(result.data) as any;
    const filtered: any = {};
    for (const key of Object.keys(rest)) {
      if (key in inferred) {
        filtered[key] = inferred[key];
      }
    }
    return filtered as Partial<InferLiveObject<T>>;
  }

  public abstract transaction<T>(
    fn: (opts: {
      trx: Storage;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}
