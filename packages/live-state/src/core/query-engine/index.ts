/** biome-ignore-all lint/suspicious/noExplicitAny: no need to be more specific */

import {
  inferValue,
  type LiveObjectAny,
  type MaterializedLiveType,
  type Schema,
} from "../../schema";
import type { Storage } from "../../server";
import { Batcher } from "../../server/storage/batcher";
import { applyWhere, extractIncludeFromWhere, type Logger } from "../../utils";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../schemas/core-protocol";
import { mergeWhereClauses, toPromiseLike } from "../utils";
import type { DataRouter, DataSource, QueryStep } from "./types";
import { hashStep } from "./utils";

export type MutationHandler = (mutation: DefaultMutation) => void;

interface QueryNode {
  hash: string;
  queryStep: QueryStep;
  trackedObjects: Set<string>;
  subscriptions: Set<MutationHandler>;
  parentQuery?: string;
  relationName?: string;
  childQueries: Set<string>;
}

interface ObjectNode {
  id: string;
  type: string;
  matchedQueries: Set<string>;
  referencesObjects: Map<string, string>;
  referencedByObjects: Map<string, Set<string>>;
}

export class QueryEngine {
  private router: DataRouter<any>;
  private storage: DataSource;
  private schema: Schema<any>;
  private logger: Logger;
  private queryNodes: Map<string, QueryNode> = new Map();
  private objectNodes: Map<string, ObjectNode> = new Map();

  constructor(opts: {
    router: DataRouter<any>;
    storage: DataSource;
    schema: Schema<any>;
    logger: Logger;
  }) {
    this.router = opts.router;
    this.storage = opts.storage;
    this.schema = opts.schema;
    this.logger = opts.logger;
  }

  private getRelationalColumns(
    resourceName: string
  ): Map<string, { relationName: string; targetResource: string }> {
    const result = new Map<
      string,
      { relationName: string; targetResource: string }
    >();
    const resourceSchema = this.schema[resourceName];

    if (!resourceSchema?.relations) return result;

    for (const [relationName, relation] of Object.entries(
      resourceSchema.relations
    )) {
      // "one" relations have relationalColumn on the source entity
      if (relation.type === "one" && relation.relationalColumn) {
        result.set(String(relation.relationalColumn), {
          relationName,
          targetResource: relation.entity.name,
        });
      }
    }

    return result;
  }

  private ensureObjectNode(
    id: string,
    type: string,
    matchedQuery?: string
  ): ObjectNode {
    let objectNode = this.objectNodes.get(id);

    if (!objectNode) {
      objectNode = {
        id,
        type,
        matchedQueries: new Set(matchedQuery ? [matchedQuery] : []),
        referencesObjects: new Map(),
        referencedByObjects: new Map(),
      };
      this.objectNodes.set(id, objectNode);
    } else if (matchedQuery) {
      objectNode.matchedQueries.add(matchedQuery);
    }

    return objectNode;
  }

  private storeRelation(
    sourceId: string,
    targetId: string,
    relationName: string,
    inverseRelationName?: string
  ): void {
    const sourceNode = this.objectNodes.get(sourceId);
    const targetNode = this.objectNodes.get(targetId);

    if (sourceNode) {
      sourceNode.referencesObjects.set(relationName, targetId);
    }

    if (targetNode && inverseRelationName) {
      let referencedBy =
        targetNode.referencedByObjects.get(inverseRelationName);
      if (!referencedBy) {
        referencedBy = new Set();
        targetNode.referencedByObjects.set(inverseRelationName, referencedBy);
      }
      referencedBy.add(sourceId);
    }
  }

  private removeRelation(
    sourceId: string,
    targetId: string,
    relationName: string,
    inverseRelationName?: string
  ): void {
    const sourceNode = this.objectNodes.get(sourceId);
    const targetNode = this.objectNodes.get(targetId);

    if (sourceNode) {
      sourceNode.referencesObjects.delete(relationName);
    }

    if (targetNode && inverseRelationName) {
      const referencedBy =
        targetNode.referencedByObjects.get(inverseRelationName);
      if (referencedBy) {
        referencedBy.delete(sourceId);
        if (referencedBy.size === 0) {
          targetNode.referencedByObjects.delete(inverseRelationName);
        }
      }
    }
  }

  private getInverseRelationName(
    sourceResource: string,
    targetResource: string,
    relationName: string
  ): string | undefined {
    const sourceSchema = this.schema[sourceResource];
    if (!sourceSchema?.relations) return undefined;

    const sourceRelation = sourceSchema.relations[relationName];
    if (!sourceRelation) return undefined;

    const targetSchema = this.schema[targetResource];
    if (!targetSchema?.relations) return undefined;

    // For a "many" relation, find the "one" relation on target with matching relationalColumn
    if (sourceRelation.type === "many" && sourceRelation.foreignColumn) {
      for (const [inverseName, relation] of Object.entries(
        targetSchema.relations
      )) {
        if (
          relation.entity.name === sourceResource &&
          relation.type === "one" &&
          relation.relationalColumn === sourceRelation.foreignColumn
        ) {
          return inverseName;
        }
      }
    }

    // For a "one" relation, find the "many" relation on target with matching foreignColumn
    if (sourceRelation.type === "one" && sourceRelation.relationalColumn) {
      for (const [inverseName, relation] of Object.entries(
        targetSchema.relations
      )) {
        if (
          relation.entity.name === sourceResource &&
          relation.type === "many" &&
          relation.foreignColumn === sourceRelation.relationalColumn
        ) {
          return inverseName;
        }
      }
    }

    return undefined;
  }

  private updateRelationsFromMutation(
    resourceName: string,
    resourceId: string,
    objValue: any,
    payload?: Record<string, any>
  ): void {
    const relationalColumns = this.getRelationalColumns(resourceName);
    const objectNode = this.objectNodes.get(resourceId);

    if (!objectNode) return;

    for (const [columnName, { relationName, targetResource }] of Array.from(
      relationalColumns
    )) {
      const wasUpdated = payload && columnName in payload;

      if (!wasUpdated) continue;

      const inverseRelationName = this.getInverseRelationName(
        resourceName,
        targetResource,
        relationName
      );

      const previousTargetId = objectNode.referencesObjects.get(relationName);

      const newTargetId = objValue[columnName];

      if (previousTargetId === newTargetId) continue;

      if (previousTargetId) {
        this.removeRelation(
          resourceId,
          previousTargetId,
          relationName,
          inverseRelationName
        );
      }

      if (newTargetId) {
        this.ensureObjectNode(newTargetId, targetResource);

        this.storeRelation(
          resourceId,
          newTargetId,
          relationName,
          inverseRelationName
        );
      }
    }
  }

  get(
    query: RawQueryRequest,
    extra?: { context?: any; batcher?: Batcher }
  ): PromiseLike<any[]> {
    const queryPlan = this.breakdownQuery({
      query,
      context: extra?.context ?? {},
    });

    return this.resolveQuery(queryPlan, {
      context: extra?.context ?? {},
      batcher: extra?.batcher ?? new Batcher(this.storage as Storage),
    });
  }

  subscribe(
    query: RawQueryRequest,
    callback: MutationHandler,
    context: any = {}
  ): () => void {
    const queryPlan = this.breakdownQuery({ query, context });

    const stepHashes: Record<string, string> = {};

    const unsubscribeFunctions: (() => void)[] = [];

    for (const step of queryPlan) {
      this.logger.debug(
        "[QueryEngine] Subscribing to step",
        step.stepPath.join(".")
      );

      const stepHash = hashStep(step);
      const lastStepHash = stepHashes[step.stepPath.at(-2) ?? ""];

      const currentRelationName = step.stepPath.at(-1) ?? "";

      const queryNode: QueryNode = {
        hash: stepHash,
        queryStep: step,
        relationName: currentRelationName,
        trackedObjects: new Set(),
        subscriptions: new Set([callback]),
        parentQuery: lastStepHash,
        childQueries: new Set(),
      };

      this.queryNodes.set(queryNode.hash, queryNode);

      if (lastStepHash) {
        const lastStepNode = this.queryNodes.get(lastStepHash);
        if (lastStepNode) {
          lastStepNode.childQueries.add(queryNode.hash);
        }
      }

      stepHashes[currentRelationName] = stepHash;

      unsubscribeFunctions.push(() => {
        const queryNode = this.queryNodes.get(stepHash);

        if (queryNode) {
          queryNode.subscriptions.delete(callback);

          if (queryNode.subscriptions.size === 0) {
            this.queryNodes.delete(stepHash);
          }
        }
      });
    }

    return () => {
      for (const unsubscribeFunction of unsubscribeFunctions) {
        unsubscribeFunction();
      }
    };
  }

  breakdownQuery(queryOrOpts: {
    query: RawQueryRequest;
    stepPath?: string[];
    context?: any;
    parentResource?: string;
  }): QueryStep[] {
    const { query, stepPath = [], context = {}, parentResource } = queryOrOpts;

    const { include } = query;

    const isRootQuery = stepPath.length === 0;
    const relationName = stepPath.at(-1);

    // For child queries, we need to set up getWhere and referenceGetter based on the relation
    let getWhere: QueryStep["getWhere"];
    let referenceGetter: QueryStep["referenceGetter"];
    let isMany: boolean | undefined;

    if (!isRootQuery && parentResource && relationName) {
      const parentSchema = this.schema[parentResource];
      const relation = parentSchema?.relations?.[relationName];

      if (relation) {
        isMany = relation.type === "many";

        if (relation.type === "one") {
          // For "one" relations, we query by ID (the related entity's ID)
          getWhere = (id: string) => ({ id });
          referenceGetter = (parentData: any[]) =>
            parentData
              .map((item) => item.value?.[relation.relationalColumn]?.value)
              .filter((v): v is string => v !== undefined);
        } else {
          // For "many" relations, we query by foreign column
          getWhere = (id: string) => ({ [relation.foreignColumn]: id });
          referenceGetter = (parentData: any[]) =>
            parentData
              .map((item) => item.value?.id?.value as string | undefined)
              .filter((v): v is string => v !== undefined);
        }
      }
    }

    // Strip include from the query since it's been processed into child steps
    const { include: _include, ...queryWithoutInclude } = query;

    const newStep = this.router.incrementQueryStep(
      {
        query: queryWithoutInclude,
        stepPath: [...stepPath],
        getWhere,
        referenceGetter,
        isMany,
        relationName,
      },
      context
    );

    const queryPlan: QueryStep[] = [newStep];

    if (
      include &&
      typeof include === "object" &&
      Object.keys(include).length > 0
    ) {
      const resourceSchema = this.schema[query.resource];

      if (!resourceSchema)
        throw new Error(`Resource ${query.resource} not found`);

      queryPlan.push(
        ...Object.entries(include).flatMap(([relName, nestedInclude]) => {
          const relation = resourceSchema.relations[relName];

          if (!relation)
            throw new Error(
              `Relation ${relName} not found for resource ${query.resource}`
            );

          const otherResourceName = relation.entity.name;

          return this.breakdownQuery({
            query: {
              resource: otherResourceName,
              include:
                typeof nestedInclude === "object" ? nestedInclude : undefined,
            },
            stepPath: [...stepPath, relName],
            context,
            parentResource: query.resource,
          });
        })
      );
    }

    return queryPlan;
  }

  resolveQuery(
    plan: QueryStep[],
    extra?: { context?: any; batcher?: Batcher }
  ): PromiseLike<any[]> {
    this.logger.debug(
      "[QueryEngine] Resolving query",
      plan.map((step) => step.stepPath.join(".")).join(" -> ")
    );

    // Map: stepPath -> array of { includedBy?: string, data: any[] }
    const stepResults: Record<string, { includedBy?: string; data: any[] }[]> =
      {};

    let chain: PromiseLike<void> = this.resolveStep(plan[0], extra).then(
      (results) => {
        this.logger.debug(
          "[QueryEngine] Resolved step",
          plan[0].stepPath.join("."),
          "with results count:",
          results.length
        );
        stepResults[plan[0].stepPath.join(".")] = [{ data: results }];
      }
    );

    for (let i = 1; i < plan.length; i++) {
      const step = plan[i];
      const parentStepPath = step.stepPath.slice(0, -1).join(".");

      chain = chain.then(async () => {
        const parentResults = stepResults[parentStepPath];
        if (!parentResults) {
          stepResults[step.stepPath.join(".")] = [];
          return;
        }

        // If we have a referenceGetter, use it to get IDs and getWhere to build queries
        if (step.referenceGetter && step.getWhere) {
          // Build a map from reference ID (e.g., authorId) to parent IDs (e.g., post IDs)
          // This allows us to track which parent each reference belongs to
          const referenceToParents = new Map<string, Set<string>>();

          for (const parentResultGroup of parentResults) {
            for (const parentItem of parentResultGroup.data) {
              const parentId = parentItem?.value?.id?.value as
                | string
                | undefined;
              if (!parentId) continue;

              const referenceIds = step.referenceGetter([parentItem]);
              const referenceId = referenceIds[0];
              if (referenceId) {
                if (!referenceToParents.has(referenceId)) {
                  referenceToParents.set(referenceId, new Set());
                }
                const parentSet = referenceToParents.get(referenceId);
                if (parentSet) {
                  parentSet.add(parentId);
                }
              }
            }
          }

          const uniqueReferenceIds = Array.from(referenceToParents.keys());

          if (uniqueReferenceIds.length === 0) {
            stepResults[step.stepPath.join(".")] = [];
            return;
          }

          // Execute a query for each unique reference ID, then distribute results to parents
          const results: { includedBy?: string; data: any[] }[] = [];

          for (const referenceId of uniqueReferenceIds) {
            const relationalWhere = step.getWhere(referenceId);
            const stepWithRelationalWhere: QueryStep = {
              ...step,
              relationalWhere,
            };

            const data = await this.resolveStep(stepWithRelationalWhere, extra);

            // For each parent that references this ID, create a result entry
            const parentIds = referenceToParents.get(referenceId);
            if (parentIds) {
              for (const parentId of Array.from(parentIds)) {
                results.push({ includedBy: parentId, data });
              }
            }
          }

          this.logger.debug(
            "[QueryEngine] Resolved step",
            step.stepPath.join("."),
            "with results count:",
            results.reduce((acc, r) => acc + r.data.length, 0)
          );
          stepResults[step.stepPath.join(".")] = results;
        } else {
          // No relation info, just resolve normally
          const data = await this.resolveStep(step, extra);
          stepResults[step.stepPath.join(".")] = [{ data }];
        }
      });
    }

    chain = chain.then((() => {
      this.logger.debug("[QueryEngine] Assembling results");
      return this.assembleResults(plan, stepResults);
    }) as () => void);

    return chain as unknown as PromiseLike<any[]>;
  }

  private assembleResults(
    plan: QueryStep[],
    stepResults: Record<string, { includedBy?: string; data: any[] }[]>
  ): any[] {
    this.logger.debug("[QueryEngine] assembleResults: Starting assembly");
    this.logger.debug(
      "[QueryEngine] assembleResults: Plan steps:",
      plan.length
    );
    this.logger.debug(
      "[QueryEngine] assembleResults: Step results keys:",
      Object.keys(stepResults)
    );

    // Build a map of all entities by their full path + id
    const entriesMap = new Map<
      string,
      {
        data: any;
        includedBy: Set<string>;
        path: string;
        isMany: boolean;
        relationName?: string;
        resourceName: string;
        includedRelations: string[];
      }
    >();

    // Process each step in order
    for (const step of plan) {
      const stepPath = step.stepPath.join(".");
      const results = stepResults[stepPath] ?? [];
      const includedRelations = Object.keys(step.query.include ?? {});

      this.logger.debug(
        `[QueryEngine] assembleResults: Processing step "${stepPath}"`,
        {
          resource: step.query.resource,
          includedRelations,
          resultGroups: results.length,
          isMany: step.isMany,
          relationName: step.relationName,
        }
      );

      for (const resultGroup of results) {
        this.logger.debug(
          `[QueryEngine] assembleResults: Processing result group for "${stepPath}"`,
          {
            dataCount: resultGroup.data.length,
            includedBy: resultGroup.includedBy,
          }
        );

        for (const data of resultGroup.data) {
          const id = data?.value?.id?.value as string | undefined;
          if (!id) {
            this.logger.debug(
              `[QueryEngine] assembleResults: Skipping data without id in step "${stepPath}"`
            );
            continue;
          }

          const key = stepPath ? `${stepPath}.${id}` : id;

          // For child queries, find parent key
          let parentKeys: string[] = [];
          if (step.stepPath.length > 0 && resultGroup.includedBy) {
            const parentStepPath = step.stepPath.slice(0, -1).join(".");
            parentKeys = [
              parentStepPath
                ? `${parentStepPath}.${resultGroup.includedBy}`
                : resultGroup.includedBy,
            ];
            this.logger.debug(
              `[QueryEngine] assembleResults: Child entity "${key}" has parent keys:`,
              parentKeys,
              {
                stepPath,
                parentStepPath,
                includedBy: resultGroup.includedBy,
              }
            );
          } else {
            this.logger.debug(
              `[QueryEngine] assembleResults: Root entity "${key}" (no parent)`
            );
          }

          const existing = entriesMap.get(key);
          if (existing) {
            this.logger.debug(
              `[QueryEngine] assembleResults: Entity "${key}" already exists, adding parent keys:`,
              parentKeys
            );
            for (const parentKey of parentKeys) {
              existing.includedBy.add(parentKey);
            }
          } else {
            this.logger.debug(
              `[QueryEngine] assembleResults: Adding new entity "${key}"`,
              {
                resource: step.query.resource,
                path: step.stepPath.at(-1) ?? "",
                isMany: step.isMany ?? false,
                relationName: step.relationName,
                includedRelations,
                parentKeys,
              }
            );
            entriesMap.set(key, {
              data,
              includedBy: new Set(parentKeys),
              path: step.stepPath.at(-1) ?? "",
              isMany: step.isMany ?? false,
              relationName: step.relationName,
              resourceName: step.query.resource,
              includedRelations,
            });
          }
        }
      }
    }

    this.logger.debug(
      `[QueryEngine] assembleResults: Built entriesMap with ${entriesMap.size} entries`
    );
    this.logger.debug(
      "[QueryEngine] assembleResults: EntriesMap keys:",
      Array.from(entriesMap.keys())
    );

    // Assemble: iterate in reverse to attach children to parents
    const entriesArray = Array.from(entriesMap.entries());
    const resultData: any[] = [];

    this.logger.debug(
      `[QueryEngine] assembleResults: Starting assembly phase with ${entriesArray.length} entries`
    );

    for (let i = entriesArray.length - 1; i >= 0; i--) {
      const [key, entry] = entriesArray[i];
      const resourceSchema = this.schema[entry.resourceName];

      this.logger.debug(
        `[QueryEngine] assembleResults: Processing entry "${key}"`,
        {
          resource: entry.resourceName,
          path: entry.path,
          isMany: entry.isMany,
          relationName: entry.relationName,
          includedRelations: entry.includedRelations,
          parentKeys: Array.from(entry.includedBy),
        }
      );

      // Initialize included relations if they don't exist
      for (const includedRelation of entry.includedRelations) {
        const relationType =
          resourceSchema?.relations?.[includedRelation]?.type;
        const hasRelation = !!entry.data.value[includedRelation];
        this.logger.debug(
          `[QueryEngine] assembleResults: Checking included relation "${includedRelation}" for "${key}"`,
          {
            relationType,
            hasRelation,
            resourceHasRelation:
              !!resourceSchema?.relations?.[includedRelation],
          }
        );

        if (!entry.data.value[includedRelation]) {
          const defaultValue =
            relationType === "many" ? { value: [] } : { value: null };
          entry.data.value[includedRelation] = defaultValue;
          this.logger.debug(
            `[QueryEngine] assembleResults: Initialized relation "${includedRelation}" for "${key}" with`,
            defaultValue
          );
        } else {
          this.logger.debug(
            `[QueryEngine] assembleResults: Relation "${includedRelation}" already exists for "${key}"`,
            entry.data.value[includedRelation]
          );
        }
      }

      // Root level items (no path)
      if (entry.path === "") {
        this.logger.debug(
          `[QueryEngine] assembleResults: Adding root entity "${key}" to resultData`
        );
        resultData.push(entry.data);
        continue;
      }

      // Attach to parent(s)
      this.logger.debug(
        `[QueryEngine] assembleResults: Attaching "${key}" to ${entry.includedBy.size} parent(s)`
      );
      for (const parentKey of Array.from(entry.includedBy)) {
        const parent = entriesMap.get(parentKey);
        if (!parent) {
          this.logger.warn(
            `[QueryEngine] assembleResults: WARNING - Parent "${parentKey}" not found in entriesMap for child "${key}"`
          );
          continue;
        }

        const relationName = entry.relationName ?? entry.path;
        this.logger.debug(
          `[QueryEngine] assembleResults: Attaching "${key}" to parent "${parentKey}" via relation "${relationName}"`,
          {
            isMany: entry.isMany,
            parentHasRelation: !!parent.data.value[relationName],
          }
        );

        if (entry.isMany) {
          parent.data.value[relationName] ??= { value: [] };
          parent.data.value[relationName].value.push(entry.data);
          this.logger.debug(
            `[QueryEngine] assembleResults: Added "${key}" to many relation "${relationName}" on parent "${parentKey}"`,
            {
              arrayLength: parent.data.value[relationName].value.length,
            }
          );
        } else {
          parent.data.value[relationName] = entry.data;
          this.logger.debug(
            `[QueryEngine] assembleResults: Set one relation "${relationName}" on parent "${parentKey}" to "${key}"`
          );
        }
      }
    }

    this.logger.debug(
      `[QueryEngine] assembleResults: Assembly complete. Returning ${resultData.length} root items`
    );
    return resultData;
  }

  resolveStep(
    step: QueryStep,
    extra?: { context?: any; batcher?: Batcher }
  ): PromiseLike<any[]> {
    this.logger.debug(
      "[QueryEngine] Resolving step",
      step.stepPath.join("."),
      "with query",
      JSON.stringify(step.query, null, 2),
      "relationalWhere",
      JSON.stringify(step.relationalWhere, null, 2)
    );

    const { query, relationalWhere } = step;

    // Combine normal where clause with relational where clause
    const combinedWhere =
      query.where && relationalWhere
        ? mergeWhereClauses(query.where, relationalWhere)
        : (relationalWhere ?? query.where);

    const queryWithCombinedWhere = combinedWhere
      ? { ...query, where: combinedWhere }
      : query;

    return toPromiseLike(this.router.get(queryWithCombinedWhere, extra)).then(
      (results) => {
        this.loadStepResults(step, results);
        return results;
      }
    );
  }

  loadStepResults(step: QueryStep, results: any[]): void {
    this.logger.debug(
      "[QueryEngine] Loading step results",
      step.stepPath.join("."),
      "with results",
      JSON.stringify(results, null, 2)
    );

    const stepHash = hashStep(step);
    const queryNode = this.queryNodes.get(stepHash);
    const resourceName = step.query.resource;

    if (!queryNode) return;

    const relationalColumns = this.getRelationalColumns(resourceName);

    for (const rawResult of results) {
      const result = inferValue(rawResult);
      const id = result.id;

      this.ensureObjectNode(id, resourceName, stepHash);
      queryNode.trackedObjects.add(id);

      for (const [columnName, { relationName, targetResource }] of Array.from(
        relationalColumns
      )) {
        const targetId = result[columnName];
        if (targetId) {
          this.ensureObjectNode(targetId, targetResource);

          const inverseRelationName = this.getInverseRelationName(
            resourceName,
            targetResource,
            relationName
          );

          this.storeRelation(id, targetId, relationName, inverseRelationName);
        }
      }

      this.loadNestedRelations(resourceName, id, result);
      this.logger.debug("[QueryEngine] Loaded nested relations for", id);
    }
  }

  private loadNestedRelations(
    resourceName: string,
    objectId: string,
    data: any
  ): void {
    const resourceSchema = this.schema[resourceName];
    if (!resourceSchema?.relations) return;

    for (const [relationName, relation] of Object.entries(
      resourceSchema.relations
    )) {
      const nestedData = data[relationName];
      if (!nestedData) continue;

      const targetResource = relation.entity.name;
      const inverseRelationName = this.getInverseRelationName(
        resourceName,
        targetResource,
        relationName
      );

      if (relation.type === "one") {
        if (nestedData && typeof nestedData === "object" && nestedData.id) {
          this.ensureObjectNode(nestedData.id, targetResource);
          this.storeRelation(
            objectId,
            nestedData.id,
            relationName,
            inverseRelationName
          );
          this.loadNestedRelations(targetResource, nestedData.id, nestedData);
        }
      } else if (relation.type === "many") {
        if (Array.isArray(nestedData)) {
          for (const item of nestedData) {
            if (item && typeof item === "object" && item.id) {
              this.ensureObjectNode(item.id, targetResource);
              // For "many" relations, the relation is stored on the child pointing to parent
              // But we also track the reverse reference
              const reverseInverse = this.getInverseRelationName(
                targetResource,
                resourceName,
                relationName
              );
              if (reverseInverse) {
                this.storeRelation(
                  item.id,
                  objectId,
                  reverseInverse,
                  relationName
                );
              }
              this.loadNestedRelations(targetResource, item.id, item);
            }
          }
        }
      }
    }
  }

  /**
   * Builds an include object from a query node's child queries recursively.
   * This allows fetching related data when an object moves into scope.
   */
  private buildIncludeFromChildQueries(queryHash: string): Record<string, any> {
    const queryNode = this.queryNodes.get(queryHash);
    if (!queryNode || queryNode.childQueries.size === 0) return {};

    const include: Record<string, any> = {};

    for (const childHash of Array.from(queryNode.childQueries)) {
      const childNode = this.queryNodes.get(childHash);
      if (!childNode || !childNode.relationName) continue;

      const nestedInclude = this.buildIncludeFromChildQueries(childHash);

      include[childNode.relationName] =
        Object.keys(nestedInclude).length > 0 ? nestedInclude : true;
    }

    return include;
  }

  /**
   * Recursively sends INSERT mutations for an object and all its included relations.
   * This is used when an object moves into scope to notify subscribers of the entire tree.
   */
  private sendInsertsForTree(
    queryNode: QueryNode,
    data: any,
    resourceName: string
  ): void {
    const id = data?.value?.id?.value as string | undefined;
    if (!id) return;

    // Send INSERT for this object
    const insertMutation: DefaultMutation = {
      procedure: "INSERT",
      resource: resourceName,
      resourceId: id,
      type: "MUTATE",
      payload: data.value,
    };

    for (const subscription of Array.from(queryNode.subscriptions)) {
      try {
        subscription(insertMutation);
      } catch (error) {
        this.logger.error(
          "[QueryEngine] Error in subscription callback during sendInsertsForTree",
          {
            error,
            queryHash: queryNode.hash,
            resource: resourceName,
            resourceId: id,
            stepPath: queryNode.queryStep.stepPath.join("."),
          }
        );
      }
    }

    // Track this object in the query
    queryNode.trackedObjects.add(id);
    const objectNode = this.ensureObjectNode(id, resourceName, queryNode.hash);
    objectNode.matchedQueries.add(queryNode.hash);

    // Process child queries and send INSERTs for related objects
    for (const childHash of Array.from(queryNode.childQueries)) {
      const childQueryNode = this.queryNodes.get(childHash);
      if (!childQueryNode || !childQueryNode.relationName) continue;

      const relationName = childQueryNode.relationName;
      const childResource = childQueryNode.queryStep.query.resource;
      const relatedData = data.value[relationName];

      if (!relatedData) continue;

      // Handle both single objects and arrays
      const relatedItems = relatedData.value;
      if (Array.isArray(relatedItems)) {
        for (const item of relatedItems) {
          this.sendInsertsForTree(childQueryNode, item, childResource);
        }
      } else if (relatedItems && typeof relatedItems === "object") {
        this.sendInsertsForTree(childQueryNode, relatedItems, childResource);
      }
    }
  }

  public handleMutation(
    mutation: DefaultMutation,
    entityValue: MaterializedLiveType<LiveObjectAny>
  ) {
    if (mutation.procedure === "INSERT") {
      if (this.objectNodes.has(mutation.resourceId)) return;

      const objValue = inferValue(entityValue);

      if (!objValue) return;

      const newObjectNode: ObjectNode = {
        id: mutation.resourceId,
        type: mutation.resource,
        matchedQueries: new Set(),
        referencesObjects: new Map(),
        referencedByObjects: new Map(),
      };

      this.objectNodes.set(mutation.resourceId, newObjectNode);

      const relationalColumns = this.getRelationalColumns(mutation.resource);
      for (const [columnName, { relationName, targetResource }] of Array.from(
        relationalColumns
      )) {
        const targetId = objValue[columnName];
        if (targetId) {
          this.ensureObjectNode(targetId, targetResource);

          const inverseRelationName = this.getInverseRelationName(
            mutation.resource,
            targetResource,
            relationName
          );

          this.storeRelation(
            mutation.resourceId,
            targetId,
            relationName,
            inverseRelationName
          );
        }
      }

      const storedObjectNode = this.objectNodes.get(mutation.resourceId);

      this.getMatchingQueries(mutation, objValue).then((matchingQueries) => {
        for (const queryHash of matchingQueries) {
          const queryNode = this.queryNodes.get(queryHash);

          if (!queryNode) continue; // TODO should we throw an error here?

          queryNode.trackedObjects.add(mutation.resourceId);

          if (storedObjectNode) {
            storedObjectNode.matchedQueries.add(queryHash);
          }

          for (const subscription of Array.from(queryNode.subscriptions)) {
            try {
              subscription(mutation);
            } catch (error) {
              this.logger.error(
                "[QueryEngine] Error in subscription callback during INSERT mutation",
                {
                  error,
                  queryHash: queryNode.hash,
                  resource: mutation.resource,
                  resourceId: mutation.resourceId,
                  stepPath: queryNode.queryStep.stepPath.join("."),
                }
              );
            }
          }
        }
      });

      return;
    }
    if (mutation.procedure === "UPDATE") {
      const objValue = inferValue(entityValue);

      if (!objValue) return;

      // Step 1: Ensure object node exists and update object relations first
      let objectNode = this.objectNodes.get(mutation.resourceId);
      const previouslyMatchedQueries = new Set(
        objectNode?.matchedQueries ?? []
      );

      if (!objectNode) {
        objectNode = {
          id: mutation.resourceId,
          type: mutation.resource,
          matchedQueries: new Set(),
          referencesObjects: new Map(),
          referencedByObjects: new Map(),
        };
        this.objectNodes.set(mutation.resourceId, objectNode);
      }

      // Update object relations before checking query matching
      this.updateRelationsFromMutation(
        mutation.resource,
        mutation.resourceId,
        objValue,
        mutation.payload
      );

      // Step 2: Use getMatchingQueries to determine current matching state
      this.getMatchingQueries(mutation, objValue).then(
        (matchingQueryHashes) => {
          const matchingQueriesSet = new Set(matchingQueryHashes);

          const newlyMatchedQueries: string[] = [];
          const noLongerMatchedQueries: string[] = [];
          const stillMatchedQueries: string[] = [];

          // Determine newly matched queries
          for (const queryHash of matchingQueryHashes) {
            if (previouslyMatchedQueries.has(queryHash)) {
              stillMatchedQueries.push(queryHash);
            } else {
              newlyMatchedQueries.push(queryHash);
            }
          }

          // Determine no longer matched queries
          for (const queryHash of Array.from(previouslyMatchedQueries)) {
            if (!matchingQueriesSet.has(queryHash)) {
              noLongerMatchedQueries.push(queryHash);
            }
          }

          // Update query node tracking
          for (const queryHash of newlyMatchedQueries) {
            const queryNode = this.queryNodes.get(queryHash);
            if (queryNode) {
              queryNode.trackedObjects.add(mutation.resourceId);
            }
          }

          for (const queryHash of noLongerMatchedQueries) {
            const queryNode = this.queryNodes.get(queryHash);
            if (queryNode) {
              queryNode.trackedObjects.delete(mutation.resourceId);
            }
          }

          // Update object node matched queries
          const currentObjectNode = this.objectNodes.get(mutation.resourceId);
          if (currentObjectNode) {
            for (const queryHash of newlyMatchedQueries) {
              currentObjectNode.matchedQueries.add(queryHash);
            }
            for (const queryHash of noLongerMatchedQueries) {
              currentObjectNode.matchedQueries.delete(queryHash);
            }
          }

          // Notify subscriptions for still matched and no longer matched queries
          for (const queryHash of [
            ...noLongerMatchedQueries,
            ...stillMatchedQueries,
          ]) {
            const queryNode = this.queryNodes.get(queryHash);

            if (!queryNode) continue;

            for (const subscription of Array.from(queryNode.subscriptions)) {
              try {
                subscription(mutation);
              } catch (error) {
                this.logger.error(
                  "[QueryEngine] Error in subscription callback during UPDATE mutation",
                  {
                    error,
                    queryHash: queryNode.hash,
                    resource: mutation.resource,
                    resourceId: mutation.resourceId,
                    stepPath: queryNode.queryStep.stepPath.join("."),
                  }
                );
              }
            }
          }

          // For newly matched queries, fetch full data with includes and send INSERT mutations
          // for the object and all its children down the tree
          if (newlyMatchedQueries.length > 0) {
            for (const queryHash of newlyMatchedQueries) {
              const queryNode = this.queryNodes.get(queryHash);

              if (!queryNode) continue;

              // Build include structure from child queries
              const include = this.buildIncludeFromChildQueries(queryHash);

              this.get({
                resource: mutation.resource,
                where: { id: mutation.resourceId },
                include: Object.keys(include).length > 0 ? include : undefined,
              }).then((results: any[]) => {
                if (!results || results.length === 0) return;

                // Send INSERT for the main object and all its included children
                this.sendInsertsForTree(
                  queryNode,
                  results[0],
                  mutation.resource
                );
              });
            }
          }
        }
      );

      return;
    }
  }

  getMatchingQueries(
    mutation: DefaultMutation,
    objValue: any
  ): PromiseLike<string[]> {
    const queriesToCheck: QueryNode[] = [];

    // TODO map queries by resource
    for (const queryNode of Array.from(this.queryNodes.values())) {
      if (queryNode.queryStep.query.resource !== mutation.resource) continue;
      queriesToCheck.push(queryNode);
    }

    if (queriesToCheck.length === 0) return toPromiseLike([]);

    return Promise.all(
      queriesToCheck.map(async (queryNode) => {
        const where = queryNode.queryStep.query.where;
        const resource = queryNode.queryStep.query.resource;
        const resourceId = mutation.resourceId;
        const objectNode = this.objectNodes.get(resourceId);

        if (!objectNode) return { hash: queryNode.hash, matches: false };

        if (queryNode.relationName) {
          // queryNode.relationName is the relation from the parent's perspective (e.g., "posts" on User)
          // but referencesObjects uses the relation from this object's perspective (e.g., "author" on Post)
          // So we need to find the inverse relation name
          const parentQuery = queryNode.parentQuery
            ? this.queryNodes.get(queryNode.parentQuery)
            : undefined;
          const parentResource = parentQuery?.queryStep.query.resource;

          const inverseRelationName = parentResource
            ? this.getInverseRelationName(
                parentResource,
                resource,
                queryNode.relationName
              )
            : undefined;

          const relatedObj = inverseRelationName
            ? objectNode.referencesObjects.get(inverseRelationName)
            : undefined;
          if (!relatedObj) return { hash: queryNode.hash, matches: false };

          const relatedObjNode = this.objectNodes.get(relatedObj);
          // NEXT STEP understand why this is not true (matchedQueries)
          if (
            !relatedObjNode ||
            !parentQuery ||
            !relatedObjNode.matchedQueries.has(parentQuery.hash)
          )
            return { hash: queryNode.hash, matches: false };

          return { hash: queryNode.hash, matches: true };
        }

        if (!where) {
          return { hash: queryNode.hash, matches: true };
        }

        const include = extractIncludeFromWhere(where, resource, this.schema);
        const hasRelations = Object.keys(include).length > 0;

        if (!hasRelations && objValue !== undefined) {
          return { hash: queryNode.hash, matches: applyWhere(objValue, where) };
        }

        const fullObject = await this.storage.get({
          resource,
          where: { id: resourceId },
          include: hasRelations ? include : undefined,
        });

        if (!fullObject || fullObject.length === 0) {
          return { hash: queryNode.hash, matches: false };
        }

        const fullObjValue = inferValue(fullObject[0]);

        if (!fullObjValue) {
          return { hash: queryNode.hash, matches: false };
        }

        return {
          hash: queryNode.hash,
          matches: applyWhere(fullObjValue, where),
        };
      })
    ).then((results) => {
      return results
        .filter((result) => result.matches)
        .map((result) => result.hash);
    });
  }
}
