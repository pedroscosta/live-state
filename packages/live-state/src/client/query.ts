/** biome-ignore-all lint/complexity/noBannedTypes: <explanation> */
import type { RawQueryRequest } from "../core/schemas/core-protocol";
import type {
  IncludeClause,
  InferLiveObject,
  LiveObjectAny,
  WhereClause,
} from "../schema";
import type { Simplify } from "../utils";

export type QueryExecutor = {
  get(query: RawQueryRequest): any[];
  subscribe(
    query: RawQueryRequest,
    callback: (value: any[]) => void
  ): () => void;
};

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
> {
  private _collection: TCollection;
  private _client: QueryExecutor;
  private _where: WhereClause<TCollection>;
  private _include: TInclude;
  private _limit?: number;
  private _single?: TSingle;

  private constructor(
    collection: TCollection,
    client: QueryExecutor,
    where?: WhereClause<TCollection>,
    include?: TInclude,
    limit?: number,
    single?: TSingle
  ) {
    this._collection = collection;
    this._client = client;
    this._where = where ?? {};
    this._include = include ?? ({} as TInclude);
    this._limit = limit;
    this._single = single;

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
      this._single
    );
  }

  include<TNewInclude extends IncludeClause<TCollection>>(
    include: TNewInclude
  ) {
    return new QueryBuilder<TCollection, TInclude & TNewInclude, TSingle>(
      this._collection,
      this._client,
      this._where,
      {
        ...this._include,
        ...include,
      },
      this._limit,
      this._single
    );
  }

  get(): InferQueryResult<TCollection, TInclude, TSingle> {
    const result = this._client.get({
      resource: this._collection.name,
      where: this._where,
      include: this._include,
      limit: this._limit,
    });

    if (this._single) return result[0];

    return result as InferQueryResult<TCollection, TInclude, TSingle>;
  }

  subscribe(
    callback: (value: InferQueryResult<TCollection, TInclude, TSingle>) => void
  ): () => void {
    return this._client.subscribe(
      {
        resource: this._collection.name,
        where: this._where,
        include: this._include,
        limit: this._limit,
      },
      (v) => {
        if (this._single) return callback(v[0]);

        callback(v as InferQueryResult<TCollection, TInclude, TSingle>);
      }
    );
  }

  limit(limit: number) {
    return new QueryBuilder(
      this._collection,
      this._client,
      this._where,
      this._include,
      limit,
      this._single
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
      true
    );
  }

  toJSON() {
    return {
      resource: this._collection.name,
      where: this._where,
      include: this._include,
      limit: this._limit,
    } satisfies RawQueryRequest;
  }

  /** @internal */
  static _init<T extends LiveObjectAny>(
    collection: T,
    client: QueryExecutor
  ): QueryBuilder<T> {
    return new QueryBuilder<T>(collection, client);
  }
}
