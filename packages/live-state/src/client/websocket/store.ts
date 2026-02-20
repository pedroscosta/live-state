import fastDeepEqual from "fast-deep-equal";
import type { RawQueryRequest } from "../../core/schemas/core-protocol";
import type {
  DefaultMutationMessage,
  MutationMessage,
} from "../../core/schemas/web-socket";
import {
  type IncludeClause,
  inferValue,
  type LiveObjectAny,
  type LiveString,
  type LiveTypeAny,
  type MaterializedLiveType,
  type Schema,
  type SubQueryInclude,
  type WhereClause,
} from "../../schema";
import { applyWhere, hash, type Logger } from "../../utils";
import type { ClientOptions } from "..";
import { filterWithLimit } from "../utils";
import { ObjectGraph } from "./obj-graph";
import { KVStorage } from "./storage";

type RawObjPool = Record<
  string,
  Record<string, MaterializedLiveType<LiveObjectAny> | undefined> | undefined
>;

export class OptimisticStore {
  private rawObjPool: RawObjPool = {} as RawObjPool;
  public optimisticMutationStack: Record<string, DefaultMutationMessage[]> = {};
  public customMutationStack: MutationMessage[] = [];
  private optimisticObjGraph: ObjectGraph;
  private optimisticRawObjPool: RawObjPool = {} as RawObjPool;
  private logger: Logger;
  private onQuerySubscriptionTriggered?: (query: RawQueryRequest) => void;
  public customMutationIndex: Record<
    string,
    Array<{ resource: string; mutationId: string }>
  > = {};

  private collectionSubscriptions: Map<
    string,
    {
      callbacks: Set<(v: any) => void>;
      query: RawQueryRequest;
      flatInclude?: string[];
    }
  > = new Map();
  private querySnapshots: Record<string, any> = {};

  private kvStorage: KVStorage;

  public constructor(
    public readonly schema: Schema<any>,
    storage: ClientOptions["storage"],
    logger: Logger,
    afterLoadMutations?: (
      stack: typeof this.optimisticMutationStack,
      customStack: MutationMessage[],
      customIndex: typeof this.customMutationIndex,
    ) => void,
    onStorageLoaded?: (resource: string, itemCount: number) => void,
    onQuerySubscriptionTriggered?: (query: RawQueryRequest) => void,
  ) {
    this.logger = logger;
    this.optimisticObjGraph = new ObjectGraph(logger);
    this.kvStorage = new KVStorage();
    this.onQuerySubscriptionTriggered = onQuerySubscriptionTriggered;

    if (storage !== false) {
      this.kvStorage.init(this.schema, storage.name).then(() => {
        Promise.all([
          this.kvStorage.getMeta<typeof this.optimisticMutationStack>(
            "mutationStack",
          ),
          this.kvStorage.getMeta<MutationMessage[]>("customMutationStack"),
          this.kvStorage.getMeta<typeof this.customMutationIndex>(
            "customMutationIndex",
          ),
        ])
          .then(([mutStack, customStack, customIndex]) => {
            if (mutStack && Object.keys(mutStack).length > 0) {
              this.optimisticMutationStack = mutStack;
            }
            if (customStack && customStack.length > 0) {
              this.customMutationStack = customStack;
            }
            if (customIndex && Object.keys(customIndex).length > 0) {
              this.customMutationIndex = customIndex;
            }
            afterLoadMutations?.(
              this.optimisticMutationStack,
              this.customMutationStack,
              this.customMutationIndex,
            );
          })
          .then(() => {
            Object.entries(this.schema).forEach(([k]) => {
              this.kvStorage.get(k).then((data) => {
                if (!data || Object.keys(data).length === 0) {
                  onStorageLoaded?.(k, 0);
                  return;
                }

                const dataArray = Object.entries(data).map(([k, v]) => ({
                  ...v,
                  id: { value: k },
                }));

                onStorageLoaded?.(k, dataArray.length);
                this.loadConsolidatedState(k, dataArray);
              });
            });
          })
          .catch((e) => {
            logger.debug(
              "Storage initialization failed (may not be available in this environment):",
              e,
            );
          });
      });
    }
  }

  public get(query: RawQueryRequest, _queryKey?: string, force = false) {
    const queryKey = _queryKey ?? hash(query);

    if (this.querySnapshots[queryKey] && !force) {
      const value = this.querySnapshots[queryKey];
      if (value) return value;
    }

    let idsToFetch: string[];
    const whereId = query.where?.id;

    if (whereId === undefined) {
      idsToFetch = Object.keys(this.optimisticRawObjPool[query.resource] ?? {});
    } else if (typeof whereId === "string") {
      idsToFetch = [whereId];
    } else if (typeof whereId === "object" && whereId !== null) {
      if ("$in" in whereId && Array.isArray(whereId.$in)) {
        idsToFetch = whereId.$in as string[];
      } else if ("$eq" in whereId && typeof whereId.$eq === "string") {
        idsToFetch = [whereId.$eq];
      } else {
        idsToFetch = Object.keys(
          this.optimisticRawObjPool[query.resource] ?? {},
        );
      }
    } else {
      idsToFetch = Object.keys(this.optimisticRawObjPool[query.resource] ?? {});
    }

    let result = idsToFetch.flatMap((k) => {
      const value = inferValue(
        this.materializeOneWithInclude(k, query.include),
      );
      if (!value) return [];
      return [value];
    });

    if (query.sort && query.sort.length > 0) {
      // biome-ignore lint/suspicious/noExplicitAny: no need to type
      const sortingPredicate = (a: any, b: any) => {
        // biome-ignore lint/style/noNonNullAssertion: false positive
        for (const sort of query.sort!) {
          const aValue = a[sort.key];
          const bValue = b[sort.key];

          if (aValue < bValue) return sort.direction === "asc" ? -1 : 1;
          if (aValue > bValue) return sort.direction === "asc" ? 1 : -1;
        }

        return 0;
      };

      result.sort(sortingPredicate);
    }

    if (query.where || query.limit) {
      const whereFunc = query.where
        ? (v: any) => applyWhere(v, query.where as WhereClause<LiveObjectAny>)
        : () => true;
      result = filterWithLimit(result, whereFunc, query.limit);
    }

    if (!force && this.collectionSubscriptions.has(queryKey)) {
      this.querySnapshots[queryKey] = result;
    }

    return result;
  }

  public subscribe(query: RawQueryRequest, listener: (v: any[]) => void) {
    const key = hash(query);

    // Handles single object subscriptions

    const entry = this.collectionSubscriptions.get(key);

    if (!entry) {
      this.collectionSubscriptions.set(key, {
        callbacks: new Set(),
        query,
        flatInclude: query.include
          ? this.flattenIncludes(query.include, query.resource)
          : undefined,
      });
    }

    this.collectionSubscriptions.get(key)?.callbacks.add(listener);

    return () => {
      this.collectionSubscriptions.get(key)?.callbacks.delete(listener);

      if (this.collectionSubscriptions.get(key)?.callbacks.size === 0) {
        this.collectionSubscriptions.delete(key);
        delete this.querySnapshots[key];
      }
    };
  }

  public addMutation(
    routeName: string,
    mutation: DefaultMutationMessage,
    optimistic: boolean = false,
  ) {
    const schema = this.schema[routeName];

    this.logger.debug("Adding mutation", mutation);

    if (!schema) throw new Error("Schema not found");

    const prevValue =
      this.optimisticRawObjPool[routeName]?.[mutation.resourceId];

    if (optimistic) {
      this.optimisticMutationStack[routeName] ??=
        [] as DefaultMutationMessage[];
      this.optimisticMutationStack[routeName].push(mutation);
    } else {
      this.optimisticMutationStack[routeName] =
        this.optimisticMutationStack?.[routeName]?.filter(
          (m) => m.id !== mutation.id,
        ) ?? [];

      this.rawObjPool[routeName] ??= {};

      const newRawValue = {
        value: {
          ...(
            this.schema[routeName].mergeMutation(
              "set",
              mutation.payload as Record<
                string,
                MaterializedLiveType<LiveTypeAny>
              >,
              this.rawObjPool[routeName][mutation.resourceId],
            )[0] as MaterializedLiveType<LiveTypeAny>
          ).value,
          id: { value: mutation.resourceId },
        },
      } as MaterializedLiveType<LiveObjectAny>;

      this.rawObjPool[routeName][mutation.resourceId] = newRawValue;

      const storedPayload = newRawValue.value;

      delete storedPayload.id;

      this.kvStorage.set(routeName, mutation.resourceId, storedPayload as any);
    }

    this.kvStorage.setMeta("mutationStack", this.optimisticMutationStack);

    this.updateRawObjPool(
      routeName,
      mutation.resourceId,
      mutation.payload,
      prevValue,
    );
  }

  public undoMutation(routeName: string, mutationId: string) {
    if (!this.optimisticMutationStack[routeName]) return;

    const mutationIdx = this.optimisticMutationStack[routeName]?.findIndex(
      (m) => m.id === mutationId,
    );

    if (mutationIdx === -1) return;

    const mutation = this.optimisticMutationStack[routeName][mutationIdx];
    this.logger.debug("Removing mutation", mutation);

    const prevValue =
      this.optimisticRawObjPool[routeName]?.[mutation.resourceId];

    this.optimisticMutationStack[routeName].splice(mutationIdx, 1);

    this.kvStorage.setMeta("mutationStack", this.optimisticMutationStack);

    this.updateRawObjPool(
      routeName,
      mutation.resourceId,
      Object.fromEntries(
        Object.entries(mutation.payload).map(([k]) => [
          k,
          { value: null, _meta: {} },
        ]),
      ),
      prevValue,
    );
  }

  public addCustomMutationMessage(message: MutationMessage) {
    this.customMutationStack.push(message);
    this.kvStorage.setMeta("customMutationStack", this.customMutationStack);
  }

  public registerCustomMutation(
    messageId: string,
    mutations: Array<{ resource: string; mutationId: string }>,
  ) {
    this.customMutationIndex[messageId] = mutations;
    this.kvStorage.setMeta("customMutationIndex", this.customMutationIndex);
  }

  public confirmCustomMutation(messageId: string) {
    const mutations = this.customMutationIndex[messageId];
    if (!mutations) return;

    for (const { resource, mutationId } of mutations) {
      this.undoMutation(resource, mutationId);
    }

    delete this.customMutationIndex[messageId];
    this.kvStorage.setMeta("customMutationIndex", this.customMutationIndex);

    this.customMutationStack = this.customMutationStack.filter(
      (m) => m.id !== messageId,
    );
    this.kvStorage.setMeta("customMutationStack", this.customMutationStack);
  }

  public undoCustomMutation(
    messageId: string,
  ): Array<{ resource: string; mutationId: string; resourceId: string }> {
    const mutations = this.customMutationIndex[messageId];
    if (!mutations) return [];

    const undone: Array<{
      resource: string;
      mutationId: string;
      resourceId: string;
    }> = [];

    for (const { resource, mutationId } of mutations) {
      const mutation = this.optimisticMutationStack[resource]?.find(
        (m) => m.id === mutationId,
      );

      this.undoMutation(resource, mutationId);

      if (mutation) {
        undone.push({ resource, mutationId, resourceId: mutation.resourceId });
      }
    }

    delete this.customMutationIndex[messageId];
    this.kvStorage.setMeta("customMutationIndex", this.customMutationIndex);

    this.customMutationStack = this.customMutationStack.filter(
      (m) => m.id !== messageId,
    );
    this.kvStorage.setMeta("customMutationStack", this.customMutationStack);

    return undone;
  }

  public getCustomMutationMutationIds(): Set<string> {
    const ids = new Set<string>();
    for (const mutations of Object.values(this.customMutationIndex)) {
      for (const { mutationId } of mutations) {
        ids.add(mutationId);
      }
    }
    return ids;
  }

  public loadConsolidatedState(
    resourceType: string,
    data: DefaultMutationMessage["payload"][],
  ) {
    data.forEach((payload) => {
      const id = payload.id?.value as string | undefined;
      if (!id) return;

      const { cleanedPayload, nestedMutations } = this.extractNestedRelations(
        resourceType,
        payload,
      );

      nestedMutations.forEach((mutation) => {
        this.addMutation(mutation.resource, mutation);
      });

      this.addMutation(resourceType, {
        id,
        type: "MUTATE",
        resource: resourceType,
        resourceId: id,
        procedure: "INSERT",
        payload: cleanedPayload,
      });
    });
  }

  private extractNestedRelations(
    resourceType: string,
    payload: DefaultMutationMessage["payload"],
  ): {
    cleanedPayload: DefaultMutationMessage["payload"];
    nestedMutations: DefaultMutationMessage[];
  } {
    const schema = this.schema[resourceType];
    const cleanedPayload: DefaultMutationMessage["payload"] = { ...payload };
    const nestedMutations: DefaultMutationMessage[] = [];

    if (!schema?.relations) {
      return { cleanedPayload, nestedMutations };
    }

    // Process each field in the payload
    Object.entries(payload).forEach(([fieldName, fieldValue]) => {
      const relation = schema.relations[fieldName];
      if (!relation) return;

      const targetResource = relation.entity.name;
      const nestedData = fieldValue?.value;

      if (relation.type === "one") {
        if (
          nestedData &&
          typeof nestedData === "object" &&
          !Array.isArray(nestedData) &&
          nestedData.id?.value
        ) {
          const nestedId = nestedData.id.value as string;

          const nestedPayload = {
            ...nestedData,
          } as DefaultMutationMessage["payload"];
          const {
            cleanedPayload: cleanedNestedPayload,
            nestedMutations: deeperMutations,
          } = this.extractNestedRelations(targetResource, nestedPayload);

          nestedMutations.push(...deeperMutations);

          nestedMutations.push({
            id: nestedId,
            type: "MUTATE",
            resource: targetResource,
            resourceId: nestedId,
            procedure: "INSERT",
            payload: cleanedNestedPayload,
          });

          delete cleanedPayload[fieldName];
        }
      } else if (relation.type === "many") {
        if (Array.isArray(nestedData)) {
          nestedData.forEach((item) => {
            if (
              item &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              item.value?.id?.value
            ) {
              const nestedId = item.value.id.value as string;

              const nestedPayload = {
                ...item.value,
              } as DefaultMutationMessage["payload"];
              const {
                cleanedPayload: cleanedNestedPayload,
                nestedMutations: deeperMutations,
              } = this.extractNestedRelations(targetResource, nestedPayload);

              nestedMutations.push(...deeperMutations);

              nestedMutations.push({
                id: nestedId,
                type: "MUTATE",
                resource: targetResource,
                resourceId: nestedId,
                procedure: "INSERT",
                payload: cleanedNestedPayload,
              });
            }
          });

          delete cleanedPayload[fieldName];
        }
      }
    });

    return { cleanedPayload, nestedMutations };
  }

  private updateRawObjPool(
    routeName: string,
    resourceId: string,
    payload: DefaultMutationMessage["payload"],
    prevValue?: MaterializedLiveType<LiveObjectAny>,
  ) {
    if (!this.schema[routeName]) return;

    const rawValue = this.rawObjPool[routeName]?.[resourceId];

    const newOptimisticValue = (
      this.optimisticMutationStack[routeName] ?? []
    ).reduce((acc, mut) => {
      if (mut.resourceId !== resourceId) return acc;

      return this.schema[routeName].mergeMutation(
        "set",
        mut.payload as Record<string, MaterializedLiveType<LiveTypeAny>>,
        acc,
      )[0];
    }, rawValue);

    this.optimisticRawObjPool[routeName] ??= {};
    if (newOptimisticValue) {
      this.optimisticRawObjPool[routeName][resourceId] = {
        value: {
          ...newOptimisticValue.value,
          id: { value: resourceId },
        },
      } as MaterializedLiveType<LiveTypeAny>;
    } else {
      delete this.optimisticRawObjPool[routeName][resourceId];
    }

    if (!this.optimisticObjGraph.hasNode(resourceId) && !newOptimisticValue)
      return;

    if (!this.optimisticObjGraph.hasNode(resourceId))
      this.optimisticObjGraph.createNode(
        resourceId,
        routeName as string,
        Object.values(this.schema[routeName].relations).flatMap((k) =>
          k.type === "many" ? [k.entity.name] : [],
        ),
      );

    if (Object.keys(this.schema[routeName].relations).length > 0) {
      // This maps the column name to the relation name (if it's a `one` relation)
      const schemaRelationalFields = Object.fromEntries(
        Object.entries(this.schema[routeName].relations).flatMap(([k, r]) =>
          r.type === "one" ? [[r.relationalColumn as string, k]] : [],
        ),
      );

      Object.entries(payload).forEach(([k, v]) => {
        const rel = this.schema[routeName].relations[schemaRelationalFields[k]];

        if (!schemaRelationalFields[k]) return;

        const prevRelation = prevValue?.value[
          k as keyof (typeof prevValue)["value"]
        ] as MaterializedLiveType<LiveString> | undefined;

        const [, updatedRelation] = rel.mergeMutation(
          "set",
          v as {
            value: string;
            _meta: { timestamp: string };
          },
          prevRelation,
        );

        if (!updatedRelation) return;

        if (!this.optimisticObjGraph.hasNode(updatedRelation.value)) {
          const otherNodeType = rel.entity.name;

          this.optimisticObjGraph.createNode(
            updatedRelation.value,
            otherNodeType,
            Object.values(this.schema[otherNodeType].relations).flatMap((r) =>
              r.type === "many" ? [r.entity.name] : [],
            ),
          );
        }

        if (prevRelation?.value) {
          this.optimisticObjGraph.removeLink(resourceId, rel.entity.name);
        }

        this.optimisticObjGraph.createLink(resourceId, updatedRelation.value);
      });
    }

    this.notifyCollectionSubscribers(routeName);

    this.optimisticObjGraph.notifySubscribers(resourceId);
  }

  private materializeOneWithInclude(
    id?: string,
    include: IncludeClause<LiveObjectAny> = {},
  ): MaterializedLiveType<LiveObjectAny> | undefined {
    if (!id) return;

    const node = this.optimisticObjGraph.getNode(id);

    if (!node) return;

    const resourceType = node.type;

    const obj = this.optimisticRawObjPool[resourceType]?.[id];

    if (!obj) return;

    const [referencesToInclude, referencedByToInclude] = Object.entries(
      include,
    ).reduce(
      (acc, [k, includeValue]) => {
        const rel = this.schema[resourceType].relations[k];
        if (!rel) return acc;

        if (rel.type === "one") {
          acc[0].push([k, rel.entity.name, includeValue ?? true]);
        } else if (rel.type === "many") {
          acc[1].push([k, rel.entity.name, includeValue ?? true]);
        }
        return acc;
      },
      [[], []] as [
        Array<[string, string, boolean | SubQueryInclude<any>]>,
        Array<[string, string, boolean | SubQueryInclude<any>]>,
      ],
    );

    return {
      value: {
        ...obj.value,
        // one relations
        ...Object.fromEntries(
          referencesToInclude.map(([k, refName, nestedInclude]) => [
            k,
            this.materializeOneWithInclude(
              node.references.get(refName),
              typeof nestedInclude === "object" && nestedInclude !== null
                ? (nestedInclude as IncludeClause<LiveObjectAny>)
                : {},
            ),
          ]),
        ),
        // many relations
        ...Object.fromEntries(
          referencedByToInclude.map(([k, refName, nestedInclude]) => {
            const referencedBy = node.referencedBy.get(refName);
            const isMany = referencedBy instanceof Set;

            return [
              k,
              isMany
                ? {
                    value: Array.from(referencedBy.values()).map((v) =>
                      this.materializeOneWithInclude(
                        v,
                        typeof nestedInclude === "object" &&
                          nestedInclude !== null
                          ? (nestedInclude as IncludeClause<LiveObjectAny>)
                          : {},
                      ),
                    ),
                  }
                : this.materializeOneWithInclude(
                    referencedBy,
                    typeof nestedInclude === "object" && nestedInclude !== null
                      ? (nestedInclude as IncludeClause<LiveObjectAny>)
                      : {},
                  ),
            ];
          }),
        ),
      },
    } as MaterializedLiveType<LiveObjectAny>;
  }

  private notifyCollectionSubscribers(collection: string) {
    this.collectionSubscriptions.forEach((s) => {
      if (
        s.query.resource === collection ||
        s.flatInclude?.includes(collection)
      ) {
        // TODO implement incremental computing
        const queryHash = hash(s.query);
        const oldResult = this.querySnapshots[queryHash];
        const newResult = this.get(s.query, undefined, true);

        if (fastDeepEqual(newResult, oldResult)) return;

        this.querySnapshots[queryHash] = newResult;

        this.onQuerySubscriptionTriggered?.(s.query);

        s.callbacks.forEach((cb) => {
          cb(newResult);
        });
      }
    });
  }

  private flattenIncludes(
    include: IncludeClause<LiveObjectAny>,
    resourceType: string,
  ): string[] {
    const result: string[] = [];

    Object.entries(include).forEach(([key, value]) => {
      const relation = this.schema[resourceType]?.relations[key];
      if (!relation) return;

      const targetEntityName = relation.entity.name;
      result.push(targetEntityName);

      if (typeof value === "object" && value !== null) {
        result.push(
          ...this.flattenIncludes(
            value as IncludeClause<LiveObjectAny>,
            targetEntityName,
          ),
        );
      }
    });

    return Array.from(new Set(result));
  }
}
