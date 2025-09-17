/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */

import {
  type IncludeClause,
  type InferLiveObject,
  inferValue,
  type LiveObjectAny,
  type LiveObjectMutationInput,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../../schema";
import type { Simplify } from "../../utils";

export abstract class Storage {
  /** @internal */
  public abstract updateSchema(opts: Schema<any>): Promise<void>;

  /** @internal */
  public abstract rawFindById<T extends LiveObjectAny>(
    resourceName: string,
    id: string,
    include?: IncludeClause<T>
  ): Promise<MaterializedLiveType<T> | undefined>;

  public abstract findOne<T extends LiveObjectAny>(
    resource: T,
    id: string,
    options?: {
      include?: IncludeClause<T>;
    }
  ): Promise<InferLiveObject<T> | undefined>;

  /** @internal */
  public abstract rawFind<T extends LiveObjectAny>(
    resourceName: string,
    where?: Record<string, any>,
    include?: Record<string, any>
  ): Promise<Record<string, MaterializedLiveType<T>>>;

  public abstract find<T extends LiveObjectAny>(
    resource: T,
    options?: {
      where?: WhereClause<T>;
      include?: IncludeClause<T>;
    }
  ): Promise<Record<string, InferLiveObject<T>>>;

  /** @internal */
  public abstract rawUpsert<T extends LiveObjectAny>(
    resourceName: string,
    resourceId: string,
    value: MaterializedLiveType<T>
  ): Promise<MaterializedLiveType<T>>;

  public async insert<T extends LiveObjectAny>(
    resource: T,
    value: Simplify<LiveObjectMutationInput<T>>
  ): Promise<InferLiveObject<T>> {
    const now = new Date().toISOString();

    return inferValue(
      await this.rawUpsert(
        resource.name,
        value.id as string,
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
    value: LiveObjectMutationInput<T>
  ): Promise<InferLiveObject<T>> {
    const now = new Date().toISOString();

    // biome-ignore lint/correctness/noUnusedVariables: id is ignored on purpose
    const { id, ...rest } = value;

    return inferValue(
      await this.rawUpsert(resource.name, resourceId, {
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
    ) as InferLiveObject<T>;
  }
}
