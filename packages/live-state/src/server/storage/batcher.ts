/** biome-ignore-all lint/suspicious/noExplicitAny: false positive */

import { mergeWhereClauses } from "../../core/utils";
import type { LiveObjectAny, MaterializedLiveType } from "../../schema";
import type { Storage } from "./interface";

interface BatchedRawFindRequest<T extends LiveObjectAny> {
  resource: string;
  commonWhere?: Record<string, any>;
  uniqueWhere?: Record<string, any>;
  include?: Record<string, any>;
  limit?: number;
  sort?: { key: string; direction: "asc" | "desc" }[];
  resolve: (value: Record<string, MaterializedLiveType<T>>) => void;
  reject: (reason?: any) => void;
}

type BatchKey = string;

export class Batcher {
  private storage: Storage;
  private queue: Map<BatchKey, BatchedRawFindRequest<any>[]> = new Map();
  private scheduled = false;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async rawFind<T extends LiveObjectAny>({
    resource,
    commonWhere,
    uniqueWhere,
    ...rest
  }: {
    resource: string;
    commonWhere?: Record<string, any>;
    uniqueWhere?: Record<string, any>;
    include?: Record<string, any>;
    limit?: number;
    sort?: { key: string; direction: "asc" | "desc" }[];
  }): Promise<Record<string, MaterializedLiveType<T>>> {
    return new Promise((resolve, reject) => {
      const batchKey = this.getBatchKey({ resource, commonWhere, ...rest });
      const request: BatchedRawFindRequest<T> = {
        resource,
        commonWhere,
        uniqueWhere,
        ...rest,
        resolve,
        reject,
      };

      if (!this.queue.has(batchKey)) {
        this.queue.set(batchKey, []);
      }
      const requestArray = this.queue.get(batchKey);
      if (requestArray) {
        requestArray.push(request);
      }

      if (!this.scheduled) {
        this.scheduled = true;
        setImmediate(() => {
          this.processBatch();
        });
      }
    });
  }

  private getBatchKey(
    query: Omit<
      BatchedRawFindRequest<any>,
      "resolve" | "reject" | "uniqueWhere"
    >
  ): BatchKey {
    const { resource, commonWhere, ...rest } = query;
    return `${resource}:${JSON.stringify(commonWhere ?? {})}:${JSON.stringify(rest ?? {})}`;
  }

  private async processBatch(): Promise<void> {
    this.scheduled = false;

    const batches = Array.from(this.queue.entries());
    this.queue.clear();

    for (const [, requests] of batches) {
      try {
        await this.executeBatchedRequests(requests);
      } catch (error) {
        requests.forEach((req): void => {
          req.reject(error);
        });
      }
    }
  }

  private async executeBatchedRequests<T extends LiveObjectAny>(
    requests: BatchedRawFindRequest<T>[]
  ): Promise<void> {
    if (requests.length === 0) return;

    const firstRequest = requests[0];
    const { resource, commonWhere, include } = firstRequest;

    // Only use limit/sort if there's exactly one request
    const singleClauses =
      requests.length === 1
        ? {
            limit: firstRequest.limit,
            sort: firstRequest.sort,
          }
        : undefined;

    const uniqueWheres = requests
      .map((req) => req.uniqueWhere)
      .filter((uw): uw is Record<string, any> => uw !== undefined);

    let where: Record<string, any> | undefined = commonWhere;

    const uniqueColumnName = Object.entries(uniqueWheres[0] ?? {})[0]?.[0];

    // Build the combined where clause with $in for unique values
    if (uniqueWheres.length > 0) {
      const uniqueValues = uniqueWheres
        .map((uw) => uw[uniqueColumnName])
        .filter((v) => v !== undefined && v !== null);

      if (uniqueValues.length > 0) {
        where = mergeWhereClauses(commonWhere, {
          [uniqueColumnName]: { $in: uniqueValues },
        });
      }
    }

    const result = await this.storage.rawFind<T>({
      resource,
      where,
      include,
      ...(singleClauses ?? {}),
    });

    // Group results by unique ID for each request
    for (const request of requests) {
      const filteredResult: Record<string, MaterializedLiveType<T>> = {};

      if (request.uniqueWhere) {
        const [uniqueColName, uniqueValue] = Object.entries(
          request.uniqueWhere
        )[0];

        for (const [id, materializedResult] of Object.entries(result)) {
          if (
            (materializedResult as MaterializedLiveType<LiveObjectAny>).value[
              uniqueColName
            ]?.value === uniqueValue
          ) {
            filteredResult[id] = materializedResult;
          }
        }
      } else {
        // If no unique where, include all results
        Object.assign(filteredResult, result);
      }

      request.resolve(filteredResult);
    }
  }
}
