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

export class QueryBuilder<
  TCollection extends LiveObjectAny,
  TInclude extends IncludeClause<TCollection> = {},
> {
  private _collection: TCollection;
  private _client: QueryExecutor;
  private _where: WhereClause<TCollection>;
  private _include: TInclude;
  private _limit?: number;

  private constructor(
    collection: TCollection,
    client: QueryExecutor,
    where?: WhereClause<TCollection>,
    include?: TInclude,
    limit?: number
  ) {
    this._collection = collection;
    this._client = client;
    this._where = where ?? {};
    this._include = include ?? ({} as TInclude);
    this._limit = limit;

    this.get = this.get.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  where(where: WhereClause<TCollection>) {
    return new QueryBuilder(
      this._collection,
      this._client,
      { ...this._where, ...where },
      this._include
    );
  }

  include<TNewInclude extends IncludeClause<TCollection>>(
    include: TNewInclude
  ) {
    return new QueryBuilder<TCollection, TInclude & TNewInclude>(
      this._collection,
      this._client,
      this._where,
      {
        ...this._include,
        ...include,
      },
      this._limit
    );
  }

  get(): Simplify<InferLiveObject<TCollection, TInclude>>[] {
    const result = this._client.get({
      resource: this._collection.name,
      where: this._where,
      include: this._include,
      limit: this._limit,
    });
    return result;
  }

  subscribe(
    callback: (
      value: Simplify<InferLiveObject<TCollection, TInclude>>[]
    ) => void
  ): () => void {
    return this._client.subscribe(
      {
        resource: this._collection.name,
        where: this._where,
        include: this._include,
        limit: this._limit,
      },
      callback
    );
  }

  limit(limit: number) {
    return new QueryBuilder(
      this._collection,
      this._client,
      this._where,
      this._include,
      limit
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
