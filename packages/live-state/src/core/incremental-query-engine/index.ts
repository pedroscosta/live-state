import {
  inferValue,
  type LiveObjectAny,
  type MaterializedLiveType,
  type Schema,
} from "../../schema";
import { applyWhere, hash } from "../../utils";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../schemas/core-protocol";

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

export class IncrementalQueryEngine {
  private queryNodes = new Map<string, QueryNode>();
  private objectNodes = new Map<string, ObjectNode>();
  private schema: Schema<any>;

  constructor(schema: Schema<any>) {
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

  public handleMutation(mutation: DefaultMutation) {
    if (mutation.procedure === "INSERT") {
      if (this.objectNodes.has(mutation.resourceId)) {
        // TODO should we throw an error here?
        return;
      }

      const objValue = inferValue({
        value: mutation.payload,
      } as MaterializedLiveType<LiveObjectAny>);

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

    // TODO handle UPDATE
  }
}
