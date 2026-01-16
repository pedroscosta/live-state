/** biome-ignore-all lint/complexity/noBannedTypes: <explanation> */

import type {
  IncludeClause,
  InferLiveObject,
  LiveObjectAny,
  WhereClause,
} from "../schema";
import type { Simplify } from "../utils";
import type { DataSource } from "./query-engine/types";
import type { RawQueryRequest } from "./schemas/core-protocol";
import type { ConditionalPromise } from "./utils";

export interface QueryExecutor extends DataSource {
  subscribe(
    query: RawQueryRequest,
    callback: (value: any[]) => void
  ): () => void;
}

type InferQueryResult<
  TCollection extends LiveObjectAny,
  TInclude extends IncludeClause<TCollection>,
  TSingle extends boolean = false,
> = TSingle extends true
  ? Simplify<InferLiveObject<TCollection, TInclude>> | undefined
  : Simplify<InferLiveObject<TCollection, TInclude>>[];

export class QueryBuilder<
  TCollection extends LiveObjectAny,
  TInclude extends IncludeClause<TCollection> = {},
  TSingle extends boolean = false,
  TShouldAwait extends boolean = false,
> {
  private _collection: TCollection;
  private _client: QueryExecutor;
  private _where: WhereClause<TCollection>;
  private _include: TInclude;
  private _limit?: number;
  private _single?: TSingle;
  private _sort?: { key: string; direction: "asc" | "desc" }[];
  private _shouldAwait?: TShouldAwait;

  private constructor(
    collection: TCollection,
    client: QueryExecutor,
    where?: WhereClause<TCollection>,
    include?: TInclude,
    limit?: number,
    single?: TSingle,
    sort?: typeof this._sort,
    shouldAwait?: TShouldAwait
  ) {
    this._collection = collection;
    this._client = client;
    this._where = where ?? {};
    this._include = include ?? ({} as TInclude);
    this._limit = limit;
    this._single = single;
    this._sort = sort;
    this._shouldAwait = shouldAwait;

    this.get = this.get.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  where(where: WhereClause<TCollection>) {
    return new QueryBuilder(
      this._collection,
      this._client,
      { ...this._where, ...where },
      this._include,
      this._limit,
      this._single,
      this._sort,
      this._shouldAwait
    );
  }

  include<TNewInclude extends IncludeClause<TCollection>>(
    include: TNewInclude
  ) {
    return new QueryBuilder(
      this._collection,
      this._client,
      this._where,
      {
        ...this._include,
        ...include,
      } as TInclude & TNewInclude,
      this._limit,
      this._single,
      this._sort,
      this._shouldAwait
    );
  }

  limit(limit: number) {
    return new QueryBuilder(
      this._collection,
      this._client,
      this._where,
      this._include,
      limit,
      this._single,
      this._sort,
      this._shouldAwait
    );
  }

  one(id: string) {
    return this.first({ id });
  }

  first(where?: WhereClause<TCollection>) {
    return new QueryBuilder(
      this._collection,
      this._client,
      where ?? this._where,
      this._include,
      1,
      true,
      this._sort,
      this._shouldAwait
    );
  }

  orderBy(key: keyof TCollection["fields"], direction: "asc" | "desc" = "asc") {
    const newSort = [...(this._sort ?? []), { key, direction }];
    return new QueryBuilder(
      this._collection,
      this._client,
      this._where,
      this._include,
      this._limit,
      this._single,
      newSort as typeof this._sort,
      this._shouldAwait
    );
  }

  toJSON() {
    return {
      resource: this._collection.name,
      where: this._where,
      include: this._include,
      limit: this._limit,
      sort: this._sort,
    } satisfies RawQueryRequest;
  }

  buildQueryRequest(): RawQueryRequest {
    return {
      resource: this._collection.name,
      where: this._where,
      include: this._include,
      limit: this._limit,
      sort: this._sort,
    };
  }

  get(): ConditionalPromise<
    InferQueryResult<TCollection, TInclude, TSingle>,
    TShouldAwait
  > {
    const promiseOrResult = this._client.get(this.buildQueryRequest());

    if (this._shouldAwait) {
      return Promise.resolve(promiseOrResult).then((result) =>
        this._single ? result[0] : result
      ) as ConditionalPromise<
        InferQueryResult<TCollection, TInclude, TSingle>,
        TShouldAwait
      >;
    }

    return this._single
      ? (promiseOrResult as any[])[0]
      : (promiseOrResult as any[] as unknown as ConditionalPromise<
          InferQueryResult<TCollection, TInclude, TSingle>,
          TShouldAwait
        >);
  }

  subscribe(
    callback: (value: InferQueryResult<TCollection, TInclude, TSingle>) => void
  ): () => void {
    return this._client.subscribe(this.buildQueryRequest(), (v) => {
      if (this._single) return callback(v[0]);

      callback(v as InferQueryResult<TCollection, TInclude, TSingle>);
    });
  }

  /** @internal */
  static _init<T extends LiveObjectAny, TShouldAwait extends boolean = false>(
    collection: T,
    client: QueryExecutor,
    shouldAwait?: TShouldAwait
  ): QueryBuilder<T, {}, false, TShouldAwait> {
    return new QueryBuilder<T, {}, false, TShouldAwait>(
      collection,
      client,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (shouldAwait ?? false) as TShouldAwait
    );
  }
}
