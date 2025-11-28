import type { DataSource, QueryExecutor } from "../../client/query";
import {
  inferValue,
  type LiveObjectAny,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../../schema";
import { applyWhere, extractIncludeFromWhere, hash } from "../../utils";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../schemas/core-protocol";
import type { Awaitable } from "../utils";

interface QueryNode extends RawQueryRequest {
  hash: string;
  matchingObjectNodes: Set<string>;
  subscriptions: Set<() => void>;
}

interface ObjectNode {
  id: string;
  type: string;
  matchedQueries: Set<string>;
}

export class IncrementalQueryEngine implements QueryExecutor {
  private queryNodes = new Map<string, QueryNode>();
  private objectNodes = new Map<string, ObjectNode>();
  private dataSource: DataSource;
  private schema: Schema<any>;

  constructor(dataSource: DataSource, schema: Schema<any>) {
    this.dataSource = dataSource;
    this.schema = schema;
  }

  public registerQuery(query: RawQueryRequest, subscription: () => void) {
    const queryHash = hash(query);

    const queryNode: QueryNode = this.queryNodes.get(queryHash) ?? {
      ...query,
      hash: queryHash,
      matchingObjectNodes: new Set(),
      subscriptions: new Set(),
    };

    queryNode.subscriptions.add(subscription);

    this.queryNodes.set(queryHash, queryNode);

    return () => {
      queryNode.subscriptions.delete(subscription);

      if (queryNode.subscriptions.size === 0) {
        this.queryNodes.delete(queryHash);
      }
    };
  }

  public loadQueryResults(query: RawQueryRequest, results: any[]) {
    const queryHash = hash(query);

    const queryNode = this.queryNodes.get(queryHash);

    if (!queryNode) {
      throw new Error(`Query with hash ${queryHash} not found`);
    }

    for (const result of results) {
      const id = result.id;

      const objectNode: ObjectNode = this.objectNodes.get(id) ?? {
        id,
        type: result.type,
        matchedQueries: new Set(),
      };

      objectNode.matchedQueries.add(queryHash);

      this.objectNodes.set(id, objectNode);

      queryNode.matchingObjectNodes.add(id);
    }
  }

  private async checkWhereMatch(
    resource: string,
    resourceId: string,
    where: WhereClause<LiveObjectAny> | undefined,
    objValue?: any
  ): Promise<boolean> {
    if (!where) {
      return true;
    }

    // Extract includes needed from the where clause
    const include = extractIncludeFromWhere(where, resource, this.schema);
    const hasRelations = Object.keys(include).length > 0;

    // If where clause is shallow (no relations) and objValue is provided, use it directly
    if (!hasRelations && objValue !== undefined) {
      return applyWhere(objValue, where);
    }

    // Query the full object with relations loaded
    const fullObject = await this.dataSource.get({
      resource,
      where: { id: resourceId },
      include: hasRelations ? include : undefined,
    });

    if (!fullObject || fullObject.length === 0) {
      return false;
    }

    const fullObjValue = inferValue(fullObject[0]);

    if (!fullObjValue) {
      return false;
    }

    // Apply where clause to the full object with relations
    return applyWhere(fullObjValue, where);
  }

  public handleMutation(
    mutation: DefaultMutation,
    enitityValue: MaterializedLiveType<LiveObjectAny>
  ) {
    if (mutation.procedure === "INSERT") {
      if (this.objectNodes.has(mutation.resourceId)) {
        // TODO should we throw an error here?
        return;
      }

      const objValue = inferValue(enitityValue);

      if (!objValue) {
        // TODO should we throw an error here?
        return;
      }

      const queriesToCheck: Array<{
        queryNode: QueryNode;
        hash: string;
        hasWhere: boolean;
      }> = [];

      for (const queryNode of Array.from(this.queryNodes.values())) {
        if (queryNode.resource !== mutation.resource) continue;
        queriesToCheck.push({
          queryNode,
          hash: queryNode.hash,
          hasWhere: !!queryNode.where,
        });
      }

      // Handle async where clause checks internally
      if (queriesToCheck.length > 0) {
        Promise.all(
          queriesToCheck.map(async ({ queryNode, hash, hasWhere }) => {
            if (!hasWhere) {
              return { hash, matches: true };
            }

            const matches = await this.checkWhereMatch(
              mutation.resource,
              mutation.resourceId,
              queryNode.where,
              objValue
            );

            return { hash, matches };
          })
        ).then((results) => {
          const matchedQueries: string[] = [];

          for (const { hash, matches } of results) {
            if (matches) {
              const queryNode = this.queryNodes.get(hash);
              if (queryNode) {
                queryNode.matchingObjectNodes.add(mutation.resourceId);
                matchedQueries.push(hash);
              }
            }
          }

          this.objectNodes.set(mutation.resourceId, {
            id: mutation.resourceId,
            type: mutation.type,
            matchedQueries: new Set(matchedQueries),
          });

          for (const queryHash of matchedQueries) {
            const queryNode = this.queryNodes.get(queryHash);

            if (!queryNode) continue; // TODO should we throw an error here?

            queryNode.subscriptions.forEach((subscription) => {
              subscription();
            });
          }
        });
      } else {
        // No queries registered for this resource, still create objectNode
        this.objectNodes.set(mutation.resourceId, {
          id: mutation.resourceId,
          type: mutation.type,
          matchedQueries: new Set(),
        });
      }

      return;
    }

    if (mutation.procedure === "UPDATE") {
      const objectNode = this.objectNodes.get(mutation.resourceId);

      if (!objectNode) {
        // TODO should we throw an error here?
        return;
      }

      const objValue = inferValue(enitityValue);

      if (!objValue) {
        // TODO should we throw an error here?
        return;
      }

      const previouslyMatchedQueries = new Set(objectNode.matchedQueries);
      const queriesToCheck: Array<{
        queryNode: QueryNode;
        hash: string;
      }> = [];

      for (const queryNode of Array.from(this.queryNodes.values())) {
        if (queryNode.resource !== mutation.resource) continue;
        queriesToCheck.push({ queryNode, hash: queryNode.hash });
      }

      // Handle async where clause checks internally
      if (queriesToCheck.length > 0) {
        Promise.all(
          queriesToCheck.map(async ({ queryNode, hash }) => {
            const matchesNow = await this.checkWhereMatch(
              mutation.resource,
              mutation.resourceId,
              queryNode.where,
              objValue
            );

            return { hash, matchesNow };
          })
        ).then((results) => {
          const newlyMatchedQueries: string[] = [];
          const queriesToNotify = new Set<string>();

          for (const { hash, matchesNow } of results) {
            const matchedBefore = previouslyMatchedQueries.has(hash);

            if (matchesNow && !matchedBefore) {
              // Query didn't match before but matches now
              const queryNode = this.queryNodes.get(hash);
              if (queryNode) {
                queryNode.matchingObjectNodes.add(mutation.resourceId);
                newlyMatchedQueries.push(hash);
                queriesToNotify.add(hash);
              }
            } else if (!matchesNow && matchedBefore) {
              // Query matched before but doesn't match now
              const queryNode = this.queryNodes.get(hash);
              if (queryNode) {
                queryNode.matchingObjectNodes.delete(mutation.resourceId);
                objectNode.matchedQueries.delete(hash);
                queriesToNotify.add(hash);
              }
            } else if (matchesNow && matchedBefore) {
              // Query still matches - notify subscribers about the update
              queriesToNotify.add(hash);
            }
          }

          // Update objectNode with newly matched queries
          for (const queryHash of newlyMatchedQueries) {
            objectNode.matchedQueries.add(queryHash);
          }

          // Notify subscribers for all queries that need to be notified
          for (const queryHash of Array.from(queriesToNotify)) {
            const queryNode = this.queryNodes.get(queryHash);

            if (!queryNode) continue; // TODO should we throw an error here?

            queryNode.subscriptions.forEach((subscription) => {
              subscription();
            });
          }
        });
      }

      return;
    }
  }

  subscribe(
    _query: RawQueryRequest,
    _callback: (value: unknown[]) => void
  ): () => void {
    throw new Error("Method not implemented.");
  }

  get(query: RawQueryRequest): Awaitable<any[]> {
    return this.dataSource.get(query);
  }
}
