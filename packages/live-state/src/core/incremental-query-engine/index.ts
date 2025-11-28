import type { DataSource, QueryExecutor } from "../../client/query";
import {
  inferValue,
  type LiveObjectAny,
  type MaterializedLiveType,
} from "../../schema";
import { applyWhere, hash } from "../../utils";
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

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
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

      const matchedQueries: string[] = [];

      for (const queryNode of Array.from(this.queryNodes.values())) {
        if (queryNode.resource !== mutation.resource) continue;

        if (!queryNode.where) {
          matchedQueries.push(queryNode.hash);
          continue;
        }

        // TODO handle deep where clauses
        if (applyWhere(objValue, queryNode.where)) {
          queryNode.matchingObjectNodes.add(mutation.resourceId);
          matchedQueries.push(queryNode.hash);
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
      const newlyMatchedQueries: string[] = [];
      const queriesToNotify = new Set<string>();

      for (const queryNode of Array.from(this.queryNodes.values())) {
        if (queryNode.resource !== mutation.resource) continue;

        const matchesNow =
          !queryNode.where || applyWhere(objValue, queryNode.where);
        const matchedBefore = previouslyMatchedQueries.has(queryNode.hash);

        if (matchesNow && !matchedBefore) {
          // Query didn't match before but matches now
          queryNode.matchingObjectNodes.add(mutation.resourceId);
          newlyMatchedQueries.push(queryNode.hash);
          queriesToNotify.add(queryNode.hash);
        } else if (!matchesNow && matchedBefore) {
          // Query matched before but doesn't match now
          queryNode.matchingObjectNodes.delete(mutation.resourceId);
          objectNode.matchedQueries.delete(queryNode.hash);
          queriesToNotify.add(queryNode.hash);
        } else if (matchesNow && matchedBefore) {
          // Query still matches - notify subscribers about the update
          queriesToNotify.add(queryNode.hash);
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

      return;
    }
  }

  subscribe(
    query: RawQueryRequest,
    callback: (value: any[]) => void
  ): () => void {
    throw new Error("Method not implemented.");
  }

  get(query: RawQueryRequest): Awaitable<any[]> {
    return this.dataSource.get(query);
  }
}
