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
import { generateId } from "../utils";

interface QueryNode extends RawQueryRequest {
  hash: string;
  matchingObjectNodes: Set<string>;
  subscriptions: Set<(mutation: DefaultMutation) => void>;
  parentQueries: Set<string>; // Hashes of parent query nodes
  parentRelationName?: string; // Relation name this child query is tracking (if it's a child query)
  childQueriesByRelation: Map<string, Set<string>>; // Map of relation name -> Set of child query hashes
}

interface ObjectNode {
  id: string;
  type: string;
  matchedQueries: Set<string>;
  // Tracks "one" relations: relationName -> relatedObjectId
  relatedObjects: Map<string, string>;
  // Tracks reverse relations: relationName -> Set of objectIds that have this relation pointing to this object
  relatedFromObjects: Map<string, Set<string>>;
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

  public registerQuery({
    query,
    subscription,
    parentQueryHash,
    parentRelationName,
  }: {
    query: RawQueryRequest;
    subscription: (mutation: DefaultMutation) => void;
    parentQueryHash?: string;
    parentRelationName?: string;
  }) {
    const queryHash = hash(query);

    const queryNode: QueryNode = this.queryNodes.get(queryHash) ?? {
      ...query,
      hash: queryHash,
      matchingObjectNodes: new Set(),
      subscriptions: new Set(),
      parentQueries: new Set(),
      childQueriesByRelation: new Map(),
    };

    queryNode.subscriptions.add(subscription);

    this.queryNodes.set(queryHash, queryNode);

    if (parentQueryHash) {
      queryNode.parentQueries.add(parentQueryHash);
      if (parentRelationName !== undefined) {
        queryNode.parentRelationName = parentRelationName;
      }
      const parentQueryNode = this.queryNodes.get(parentQueryHash);
      if (parentQueryNode && parentRelationName) {
        let childQueriesForRelation =
          parentQueryNode.childQueriesByRelation.get(parentRelationName);
        if (!childQueriesForRelation) {
          childQueriesForRelation = new Set();
          parentQueryNode.childQueriesByRelation.set(
            parentRelationName,
            childQueriesForRelation
          );
        }
        childQueriesForRelation.add(queryHash);
      }
    }

    return () => {
      queryNode.subscriptions.delete(subscription);

      if (queryNode.subscriptions.size === 0) {
        this.queryNodes.delete(queryHash);
      }

      for (const parentQueryHash of Array.from(queryNode.parentQueries)) {
        const parentQueryNode = this.queryNodes.get(parentQueryHash);
        if (parentQueryNode && queryNode.parentRelationName) {
          const childQueriesForRelation =
            parentQueryNode.childQueriesByRelation.get(
              queryNode.parentRelationName
            );
          if (childQueriesForRelation) {
            childQueriesForRelation.delete(queryHash);
            if (childQueriesForRelation.size === 0) {
              parentQueryNode.childQueriesByRelation.delete(
                queryNode.parentRelationName
              );
            }
          }
        }
      }

      // Clean up parent references from all child queries
      for (const [_relationName, childQueriesSet] of Array.from(
        queryNode.childQueriesByRelation.entries()
      )) {
        for (const childQueryHash of Array.from(childQueriesSet)) {
          const childQueryNode = this.queryNodes.get(childQueryHash);
          if (childQueryNode) {
            childQueryNode.parentQueries.delete(queryHash);
          }
        }
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
        relatedObjects: new Map(),
        relatedFromObjects: new Map(),
      };

      objectNode.matchedQueries.add(queryHash);

      this.objectNodes.set(id, objectNode);

      queryNode.matchingObjectNodes.add(id);

      // Extract and track relationships from the result
      const relationChanges = this.extractRelationsFromResult(
        query.resource,
        result,
        objectNode
      );
      if (relationChanges.size > 0) {
        this.updateRelationshipTracking(id, query.resource, relationChanges);
      }
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

  /**
   * Extracts relationships from a result object
   * Returns: Map<relationName, { oldValue?: string, newValue?: string }>
   */
  private extractRelationsFromResult(
    resource: string,
    result: any,
    objectNode: ObjectNode | undefined
  ): Map<string, { oldValue?: string; newValue?: string }> {
    const changes = new Map<string, { oldValue?: string; newValue?: string }>();
    const resourceSchema = this.schema[resource];

    if (!resourceSchema?.relations) {
      return changes;
    }

    // Map relationalColumn names to relation names for "one" relations
    const relationalColumnToRelation = new Map<string, string>();
    for (const [relationName, relation] of Object.entries(
      resourceSchema.relations
    )) {
      if (relation.type === "one" && relation.relationalColumn) {
        relationalColumnToRelation.set(
          relation.relationalColumn as string,
          relationName
        );
      }
    }

    // Get all relational columns to check
    const relationalColumns = Array.from(relationalColumnToRelation.keys());

    // Extract relations from result object
    for (const fieldName of relationalColumns) {
      const relationName = relationalColumnToRelation.get(fieldName);
      if (!relationName) continue;

      // Get value from result object
      const newValue = result[fieldName];

      // Get old value from existing objectNode's relatedObjects map
      const oldValue = objectNode?.relatedObjects.get(relationName);

      if (oldValue !== newValue) {
        changes.set(relationName, {
          oldValue: oldValue,
          newValue: newValue,
        });
      }
    }

    return changes;
  }

  /**
   * Extracts relationship changes from a mutation payload
   * Returns: Map<relationName, { oldValue?: string, newValue?: string }>
   */
  private extractRelationshipChanges(
    resource: string,
    mutation: DefaultMutation,
    objectNode: ObjectNode | undefined,
    objValue?: any
  ): Map<string, { oldValue?: string; newValue?: string }> {
    const changes = new Map<string, { oldValue?: string; newValue?: string }>();
    const resourceSchema = this.schema[resource];

    if (!resourceSchema?.relations) {
      return changes;
    }

    // Map relationalColumn names to relation names for "one" relations
    const relationalColumnToRelation = new Map<string, string>();
    for (const [relationName, relation] of Object.entries(
      resourceSchema.relations
    )) {
      if (relation.type === "one" && relation.relationalColumn) {
        relationalColumnToRelation.set(
          relation.relationalColumn as string,
          relationName
        );
      }
    }

    // Get all relational columns to check
    const relationalColumns = Array.from(relationalColumnToRelation.keys());

    // Check mutation payload for relationship changes
    for (const fieldName of relationalColumns) {
      const relationName = relationalColumnToRelation.get(fieldName);
      if (!relationName) continue;

      // Get new value from payload (if present) or objValue (as fallback)
      const payloadValue = mutation.payload[fieldName]?.value;
      const objValueField = objValue?.[fieldName];
      const newValue =
        payloadValue !== undefined ? payloadValue : objValueField;

      // Get old value from existing objectNode's relatedObjects map
      const oldValue = objectNode?.relatedObjects.get(relationName);

      if (oldValue !== newValue) {
        changes.set(relationName, {
          oldValue: oldValue,
          newValue: newValue,
        });
      }
    }

    return changes;
  }

  /**
   * Updates relationship tracking for an object
   */
  private updateRelationshipTracking(
    objectId: string,
    resource: string,
    relationChanges: Map<string, { oldValue?: string; newValue?: string }>
  ): void {
    const objectNode = this.objectNodes.get(objectId);
    if (!objectNode) return;

    const resourceSchema = this.schema[resource];
    if (!resourceSchema?.relations) return;

    for (const [relationName, { oldValue, newValue }] of Array.from(
      relationChanges.entries()
    )) {
      const relation = resourceSchema.relations[relationName];
      if (!relation || relation.type !== "one") continue;

      // Remove old relationship
      if (oldValue) {
        objectNode.relatedObjects.delete(relationName);

        // Update reverse tracking: remove this object from old related object's relatedFromObjects
        const oldRelatedObject = this.objectNodes.get(oldValue);
        if (oldRelatedObject) {
          const reverseSet =
            oldRelatedObject.relatedFromObjects.get(relationName);
          if (reverseSet) {
            reverseSet.delete(objectId);
            if (reverseSet.size === 0) {
              oldRelatedObject.relatedFromObjects.delete(relationName);
            }
          }
        }
      }

      // Add new relationship
      if (newValue) {
        objectNode.relatedObjects.set(relationName, newValue);

        // Update reverse tracking: add this object to new related object's relatedFromObjects
        let newRelatedObject = this.objectNodes.get(newValue);
        if (!newRelatedObject) {
          // Create object node if it doesn't exist yet
          newRelatedObject = {
            id: newValue,
            type: relation.entity.name,
            matchedQueries: new Set(),
            relatedObjects: new Map(),
            relatedFromObjects: new Map(),
          };
          this.objectNodes.set(newValue, newRelatedObject);
        }

        let reverseSet = newRelatedObject.relatedFromObjects.get(relationName);
        if (!reverseSet) {
          reverseSet = new Set();
          newRelatedObject.relatedFromObjects.set(relationName, reverseSet);
        }
        reverseSet.add(objectId);
      }
    }
  }

  /**
   * Updates child queries when a relation changes
   * Removes old tracked objects and adds new ones, fetching data and notifying subscribers
   */
  private async updateChildQueriesForRelationChange(
    objectId: string,
    relationName: string,
    oldValue: string | undefined,
    newValue: string | undefined
  ): Promise<void> {
    const objectNode = this.objectNodes.get(objectId);
    if (!objectNode) return;

    // Find all queries that match this object
    const matchingQueryHashes = Array.from(objectNode.matchedQueries);

    for (const queryHash of matchingQueryHashes) {
      const queryNode = this.queryNodes.get(queryHash);
      if (!queryNode) continue;

      // Check if this query has child queries tracking the changed relation
      const childQueriesForRelation =
        queryNode.childQueriesByRelation.get(relationName);
      if (!childQueriesForRelation || childQueriesForRelation.size === 0) {
        continue;
      }

      // Process each child query
      for (const childQueryHash of Array.from(childQueriesForRelation)) {
        const childQueryNode = this.queryNodes.get(childQueryHash);
        if (!childQueryNode) continue;

        // Remove old related object from child query's tracked objects
        if (oldValue) {
          childQueryNode.matchingObjectNodes.delete(oldValue);
          const oldRelatedObjectNode = this.objectNodes.get(oldValue);
          if (oldRelatedObjectNode) {
            oldRelatedObjectNode.matchedQueries.delete(childQueryHash);
          }
        }

        // Add new related object to child query's tracked objects
        if (newValue) {
          // Fetch the new object data
          const newObjectData = await this.dataSource.get({
            resource: childQueryNode.resource,
            where: { id: newValue },
            include: childQueryNode.include,
          });

          if (newObjectData && newObjectData.length > 0) {
            // Convert MaterializedLiveType to plain object if needed
            const materializedObject = newObjectData[0];
            const plainObject =
              inferValue(materializedObject) ?? materializedObject;
            const newObjectId = plainObject.id;

            // Add to matching objects
            childQueryNode.matchingObjectNodes.add(newObjectId);

            // Update object node
            let newRelatedObjectNode = this.objectNodes.get(newObjectId);
            if (!newRelatedObjectNode) {
              newRelatedObjectNode = {
                id: newObjectId,
                type: plainObject.type || childQueryNode.resource,
                matchedQueries: new Set(),
                relatedObjects: new Map(),
                relatedFromObjects: new Map(),
              };
              this.objectNodes.set(newObjectId, newRelatedObjectNode);
            }
            newRelatedObjectNode.matchedQueries.add(childQueryHash);

            // Extract and track relationships from the new object
            const relationChanges = this.extractRelationsFromResult(
              childQueryNode.resource,
              plainObject,
              newRelatedObjectNode
            );
            if (relationChanges.size > 0) {
              this.updateRelationshipTracking(
                newObjectId,
                childQueryNode.resource,
                relationChanges
              );
            }

            // Create INSERT mutation for the new object
            // Use the materialized object for payload creation to preserve _meta
            const insertMutation: DefaultMutation = {
              id: generateId(),
              type: "MUTATE",
              resource: childQueryNode.resource,
              resourceId: newObjectId,
              procedure: "INSERT",
              payload: this.createMutationPayloadFromObject(materializedObject),
            };

            // Notify subscribers of the child query
            childQueryNode.subscriptions.forEach((subscription) => {
              subscription(insertMutation);
            });
          }
        }
      }
    }
  }

  /**
   * Creates a mutation payload from an object
   * Handles both MaterializedLiveType objects and plain objects
   */
  private createMutationPayloadFromObject(
    obj: any
  ): Record<string, { value: any; _meta?: { timestamp?: string | null } }> {
    const payload: Record<
      string,
      { value: any; _meta?: { timestamp?: string | null } }
    > = {};

    // Check if obj is a MaterializedLiveType (has value property)
    const objValue =
      obj && typeof obj === "object" && "value" in obj ? obj.value : obj;

    for (const [key, value] of Object.entries(objValue)) {
      // Check if value is a MaterializedLiveType (has value and _meta)
      if (value && typeof value === "object" && "value" in value) {
        // It's a MaterializedLiveType - extract value and meta
        const metaValue = value as {
          value: any;
          _meta?: { timestamp?: string | null };
        };
        payload[key] = {
          value: metaValue.value,
          _meta: metaValue._meta?.timestamp
            ? { timestamp: metaValue._meta.timestamp }
            : undefined,
        };
      } else if (value && typeof value === "object" && "id" in value) {
        // Handle nested objects (relations) - extract just the ID if it's a relation
        const relationValue = value as {
          id: any;
          _meta?: { timestamp?: string | null };
        };
        payload[key] = {
          value: relationValue.id,
          _meta: relationValue._meta,
        };
      } else {
        // Plain value
        payload[key] = {
          value: value,
        };
      }
    }

    return payload;
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

          const newObjectNode: ObjectNode = {
            id: mutation.resourceId,
            type: mutation.type,
            matchedQueries: new Set(matchedQueries),
            relatedObjects: new Map(),
            relatedFromObjects: new Map(),
          };

          // Set objectNode first so updateRelationshipTracking can find it
          this.objectNodes.set(mutation.resourceId, newObjectNode);

          // Extract and track relationships from the new object
          const relationChanges = this.extractRelationshipChanges(
            mutation.resource,
            mutation,
            undefined, // No existing objectNode for INSERT
            objValue
          );
          this.updateRelationshipTracking(
            mutation.resourceId,
            mutation.resource,
            relationChanges
          );

          for (const queryHash of matchedQueries) {
            const queryNode = this.queryNodes.get(queryHash);

            if (!queryNode) continue; // TODO should we throw an error here?

            queryNode.subscriptions.forEach((subscription) => {
              subscription(mutation);
            });
          }
        });
      } else {
        // No queries registered for this resource, still create objectNode
        const newObjectNode: ObjectNode = {
          id: mutation.resourceId,
          type: mutation.type,
          matchedQueries: new Set(),
          relatedObjects: new Map(),
          relatedFromObjects: new Map(),
        };

        // Set objectNode first so updateRelationshipTracking can find it
        this.objectNodes.set(mutation.resourceId, newObjectNode);

        // Extract and track relationships from the new object
        const relationChanges = this.extractRelationshipChanges(
          mutation.resource,
          mutation,
          undefined, // No existing objectNode for INSERT
          objValue
        );
        this.updateRelationshipTracking(
          mutation.resourceId,
          mutation.resource,
          relationChanges
        );
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

      // Extract relationship changes before processing
      const relationChanges = this.extractRelationshipChanges(
        mutation.resource,
        mutation,
        objectNode,
        objValue
      );

      // Track affected objects (this object and related objects)
      const affectedObjectIds = new Set<string>([mutation.resourceId]);

      // Add old and new related objects to affected set
      for (const { oldValue, newValue } of Array.from(
        relationChanges.values()
      )) {
        if (oldValue) affectedObjectIds.add(oldValue);
        if (newValue) affectedObjectIds.add(newValue);
      }

      // Also check objects that have relations pointing to this object
      for (const relatedFromSet of Array.from(
        objectNode.relatedFromObjects.values()
      )) {
        for (const relatedFromId of Array.from(relatedFromSet)) {
          affectedObjectIds.add(relatedFromId);
        }
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

          // Update relationship tracking
          if (relationChanges.size > 0) {
            this.updateRelationshipTracking(
              mutation.resourceId,
              mutation.resource,
              relationChanges
            );

            // Update child queries for each relation change
            for (const [relationName, { oldValue, newValue }] of Array.from(
              relationChanges.entries()
            )) {
              // Only process if there's an actual change (old !== new)
              if (oldValue !== newValue) {
                this.updateChildQueriesForRelationChange(
                  mutation.resourceId,
                  relationName,
                  oldValue,
                  newValue
                ).catch((error) => {
                  // Log error but don't throw - we don't want to break the mutation flow
                  console.error(
                    `Error updating child queries for relation ${relationName}:`,
                    error
                  );
                });
              }
            }
          }

          // Notify subscribers for all queries that need to be notified
          for (const queryHash of Array.from(queriesToNotify)) {
            const queryNode = this.queryNodes.get(queryHash);

            if (!queryNode) continue; // TODO should we throw an error here?

            queryNode.subscriptions.forEach((subscription) => {
              subscription(mutation);
            });
          }
        });
      } else {
        // No queries to check, but still update relationship tracking
        if (relationChanges.size > 0) {
          this.updateRelationshipTracking(
            mutation.resourceId,
            mutation.resource,
            relationChanges
          );

          // Update child queries for each relation change
          for (const [relationName, { oldValue, newValue }] of Array.from(
            relationChanges.entries()
          )) {
            // Only process if there's an actual change (old !== new)
            if (oldValue !== newValue) {
              this.updateChildQueriesForRelationChange(
                mutation.resourceId,
                relationName,
                oldValue,
                newValue
              ).catch((error) => {
                // Log error but don't throw - we don't want to break the mutation flow
                console.error(
                  `Error updating child queries for relation ${relationName}:`,
                  error
                );
              });
            }
          }
        }
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
