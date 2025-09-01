import { type RawQueryRequest } from "../core/schemas/core-protocol";
import {
  WhereClause,
  type InferLiveObject,
  type LiveObjectAny,
} from "../schema";
import { Simplify } from "../utils";

export type QueryExecutor = {
  get(query: RawQueryRequest): any[];
  subscribe(
    query: RawQueryRequest,
    callback: (value: any[]) => void
  ): () => void;
};

export class QueryBuilder<TCollection extends LiveObjectAny> {
  private _collection: TCollection;
  private _client: QueryExecutor;
  private _where: WhereClause<TCollection>;

  private constructor(
    collection: TCollection,
    client: QueryExecutor,
    where?: WhereClause<TCollection>
  ) {
    this._collection = collection;
    this._client = client;
    this._where = where ?? {};
  }

  where(where: WhereClause<TCollection>) {
    return new QueryBuilder(this._collection, this._client, where);
  }

  get(): Simplify<InferLiveObject<TCollection>>[] {
    console.debug("Getting", this._collection.name);
    const result = this._client.get({
      resource: this._collection.name,
      where: this._where,
    });
    console.debug("Got", this._collection.name, result);
    return result;
  }

  subscribe(
    callback: (value: Simplify<InferLiveObject<TCollection>>[]) => void
  ): () => void {
    return this._client.subscribe(
      {
        resource: this._collection.name,
        where: this._where,
      },
      callback
    );
  }

  /** @internal */
  static _init<T extends LiveObjectAny>(
    collection: T,
    client: QueryExecutor
  ): QueryBuilder<T> {
    return new QueryBuilder<T>(collection, client);
  }
}
