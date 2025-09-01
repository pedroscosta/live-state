import { type RawQueryRequest } from "../core/schemas/core-protocol";
import type { InferLiveObject, LiveObjectAny } from "../schema";
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
  private client: QueryExecutor;

  private constructor(collection: TCollection, client: QueryExecutor) {
    this._collection = collection;
    this.client = client;
  }

  get(): Simplify<InferLiveObject<TCollection>>[] {
    console.debug("Getting", this._collection.name);
    const result = this.client.get({
      resource: this._collection.name,
    });
    console.debug("Got", this._collection.name, result);
    return result;
  }

  subscribe(
    callback: (value: Simplify<InferLiveObject<TCollection>>[]) => void
  ): () => void {
    return this.client.subscribe(
      {
        resource: this._collection.name,
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
