import fastDeepEqual from "fast-deep-equal";
import type { RawQueryRequest } from "../../core/schemas/core-protocol";
import type { DefaultMutationMessage } from "../../core/schemas/web-socket";
import {
  type IncludeClause,
  type InferLiveType,
  inferValue,
  type LiveObjectAny,
  type LiveString,
  type LiveTypeAny,
  type MaterializedLiveType,
  type Schema,
  type WhereClause,
} from "../../schema";
import { hash } from "../../utils";
import type { ClientOptions } from "..";
import { applyWhere, filterWithLimit } from "../utils";
import { type GraphNode, ObjectGraph } from "./obj-graph";
import { KVStorage } from "./storage";

type RawObjPool = Record<
  string,
  Record<string, MaterializedLiveType<LiveObjectAny> | undefined> | undefined
>;

export class OptimisticStore {
  private rawObjPool: RawObjPool = {} as RawObjPool;
  public optimisticMutationStack: Record<string, DefaultMutationMessage[]> = {};
  private optimisticObjGraph: ObjectGraph = new ObjectGraph();
  private optimisticRawObjPool: RawObjPool = {} as RawObjPool;

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
    afterLoadMutations?: (stack: typeof this.optimisticMutationStack) => void
  ) {
    this.kvStorage = new KVStorage();

    if (storage !== false) {
      this.kvStorage.init(this.schema, storage.name).then(() => {
        this.kvStorage
          .getMeta<typeof this.optimisticMutationStack>("mutationStack")
          .then((data) => {
            if (!data || Object.keys(data).length === 0) return;
            this.optimisticMutationStack = data;
            afterLoadMutations?.(this.optimisticMutationStack);
          })
          .then(() => {
            Object.entries(this.schema).forEach(([k, v]) => {
              this.kvStorage.get(k).then((data) => {
                if (!data || Object.keys(data).length === 0) return;
                this.loadConsolidatedState(k, data);
              });
            });
          })
          .catch((e) => {
            console.error("Failed to load state from storage", e);
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

    let result = Object.keys(
      this.optimisticRawObjPool[query.resource] ?? {}
    ).map((k) =>
      inferValue(this.materializeOneWithInclude(k, query.include))
    ) as InferLiveType<LiveObjectAny>[];

    if (query.where || query.limit) {
      const whereFunc = query.where
        ? (v: any) => applyWhere(v, query.where as WhereClause<LiveObjectAny>)
        : () => true;
      result = filterWithLimit(result, whereFunc, query.limit);
    }

    if (!force) this.querySnapshots[queryKey] = result;

    return result;
  }

  public getOne(
    resourceType: string,
    id: string
  ): InferLiveType<LiveObjectAny> | undefined {
    const node = this.optimisticObjGraph.getNode(id);

    if (!node) return;

    const obj = this.optimisticRawObjPool[resourceType]?.[id];

    if (!obj) return;

    const materializedObj = {
      value: {
        ...obj.value,
        ...Object.fromEntries(
          Array.from(node.references.entries()).map(([k, v]) => {
            const otherNode = this.optimisticObjGraph.getNode(v);

            if (!otherNode) return [k, undefined];

            const [relationName, relation] =
              Object.entries(this.schema[resourceType].relations).find(
                (r) => r[1].relationalColumn === k || r[1].foreignColumn === k
              ) ?? [];

            const otherNodeType = relation?.entity.name;

            if (!otherNodeType || !relation) return [k, undefined];

            return [
              relationName,
              this.optimisticRawObjPool[otherNodeType]?.[
                (otherNode as GraphNode).id
              ],
            ];
          })
        ),
        ...Object.fromEntries(
          Array.from(node.referencedBy.entries()).map(([k, v]) => {
            const isMany = v instanceof Set;

            const otherNode = isMany
              ? Array.from(v.values()).flatMap((v) => {
                  const node = this.optimisticObjGraph.getNode(v);

                  return node ? [node] : [];
                })
              : this.optimisticObjGraph.getNode(v);

            if (!otherNode) return [k, undefined];

            const [relationName, relation] =
              Object.entries(this.schema[resourceType].relations).find(
                (r) => r[1].entity.name === k
              ) ?? [];

            const otherNodeType = relation?.entity.name;

            if (!otherNodeType || !relation)
              return [k, isMany ? [] : undefined];

            return [
              relationName,
              isMany
                ? {
                    value: (otherNode as GraphNode[]).map(
                      (v) => this.optimisticRawObjPool[otherNodeType]?.[v.id]
                    ),
                  }
                : this.optimisticRawObjPool[otherNodeType]?.[
                    (otherNode as GraphNode).id
                  ],
            ];
          })
        ),
      },
    } as MaterializedLiveType<LiveObjectAny>;

    return inferValue(materializedObj);
  }

  public subscribe(query: RawQueryRequest, listener: (v: any[]) => void) {
    const key = hash(query);

    const entry = this.collectionSubscriptions.get(key);

    const schema = this.schema[query.resource];

    if (!entry) {
      this.collectionSubscriptions.set(key, {
        callbacks: new Set(),
        query,
        flatInclude: query.include
          ? Object.keys(query.include).map(
              (k) => schema.relations[k].entity.name
            )
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

    // if (path.length === 2) {
    //   const node = this.optimisticObjGraph.getNode(path[1]);

    //   if (!node) throw new Error("Node not found");

    //   return this.optimisticObjGraph.subscribe(path[1], listener);
    // }

    // throw new Error("Not implemented");
  }

  public addMutation(
    routeName: string,
    mutation: DefaultMutationMessage,
    optimistic: boolean = false
  ) {
    const schema = this.schema[routeName];

    console.log("Adding mutation", mutation);

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
          (m) => m.id !== mutation.id
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
              this.rawObjPool[routeName][mutation.resourceId]
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

    const rawValue = this.rawObjPool[routeName]?.[mutation.resourceId];

    const newOptimisticValue = (
      this.optimisticMutationStack[routeName] ?? []
    ).reduce((acc, mut) => {
      if (mut.resourceId !== mutation.resourceId) return acc;

      return this.schema[routeName].mergeMutation(
        "set",
        mut.payload as Record<string, MaterializedLiveType<LiveTypeAny>>,
        acc
      )[0];
    }, rawValue);

    if (newOptimisticValue) {
      this.optimisticRawObjPool[routeName] ??= {};
      this.optimisticRawObjPool[routeName][mutation.resourceId] = {
        value: {
          ...newOptimisticValue.value,
          id: { value: mutation.resourceId },
        },
      } as MaterializedLiveType<LiveTypeAny>;
    }

    if (!this.optimisticObjGraph.hasNode(mutation.resourceId))
      this.optimisticObjGraph.createNode(
        mutation.resourceId,
        routeName as string,
        Object.values(schema.relations).flatMap((k) =>
          k.type === "many" ? [k.entity.name] : []
        )
      );

    if (Object.keys(schema.relations).length > 0) {
      // This maps the column name to the relation name (if it's a `one` relation)
      const schemaRelationalFields = Object.fromEntries(
        Object.entries(schema.relations).flatMap(([k, r]) =>
          r.type === "one" ? [[r.relationalColumn as string, k]] : []
        )
      );

      Object.entries(mutation.payload).forEach(([k, v]) => {
        const rel = schema.relations[schemaRelationalFields[k]];

        if (!v || !schemaRelationalFields[k]) return;

        const prevRelation = prevValue?.value[
          k as keyof (typeof prevValue)["value"]
        ] as MaterializedLiveType<LiveString> | undefined;

        const [, updatedRelation] = rel.mergeMutation(
          "set",
          v as { value: string; _meta: { timestamp: string } },
          prevRelation
        );

        if (!updatedRelation) return;

        if (!this.optimisticObjGraph.hasNode(updatedRelation.value)) {
          const otherNodeType = rel.entity.name;

          this.optimisticObjGraph.createNode(
            updatedRelation.value,
            otherNodeType,
            Object.values(this.schema[otherNodeType].relations).flatMap((r) =>
              r.type === "many" ? [r.entity.name] : []
            )
          );
        }

        if (prevRelation?.value) {
          this.optimisticObjGraph.removeLink(
            mutation.resourceId,
            rel.entity.name
          );
        }

        this.optimisticObjGraph.createLink(
          mutation.resourceId,
          updatedRelation.value
        );
      });
    }

    this.notifyCollectionSubscribers(routeName);

    this.optimisticObjGraph.notifySubscribers(mutation.resourceId);
  }

  public loadConsolidatedState(
    resourceType: string,
    data: Record<string, DefaultMutationMessage["payload"]>
  ) {
    Object.entries(data).forEach(([id, payload]) => {
      this.addMutation(resourceType, {
        // this id is not used because only this client will see this mutation, so it can be any unique string
        // since resource's ids are already unique, there is no need to generate a new id
        id,
        type: "MUTATE",
        resource: resourceType,
        resourceId: id,
        payload,
      });
    });
  }

  private materializeOneWithInclude(
    id?: string,
    include: IncludeClause<LiveObjectAny> = {}
  ): MaterializedLiveType<LiveObjectAny> | undefined {
    if (!id) return;

    const node = this.optimisticObjGraph.getNode(id);

    if (!node) return;

    const resourceType = node.type;

    const obj = this.optimisticRawObjPool[resourceType]?.[id];

    if (!obj) return;

    const [referencesToInclude, referencedByToInclude] = Object.keys(
      include
    ).reduce(
      (acc, k) => {
        const rel = this.schema[resourceType].relations[k];
        if (rel.type === "one") {
          acc[0].push([k, rel.entity.name]);
        } else if (rel.type === "many") {
          acc[1].push([k, rel.entity.name]);
        }
        return acc;
      },
      [[], []] as [string[][], string[][]]
    );

    return {
      value: {
        ...obj.value,
        // one relations
        ...Object.fromEntries(
          referencesToInclude.map(([k, refName]) => [
            k,
            this.materializeOneWithInclude(node.references.get(refName)),
          ])
        ),
        // many relations
        ...Object.fromEntries(
          referencedByToInclude.map(([k, refName]) => {
            const referencedBy = node.referencedBy.get(refName);
            const isMany = referencedBy instanceof Set;

            return [
              k,
              isMany
                ? {
                    value: Array.from(referencedBy.values()).map((v) =>
                      this.materializeOneWithInclude(v)
                    ),
                  }
                : this.materializeOneWithInclude(referencedBy),
            ];
          })
        ),
      },
    } as MaterializedLiveType<LiveObjectAny>;
  }

  private notifyCollectionSubscribers(collection: string) {
    this.collectionSubscriptions.forEach((s) => {
      if (
        s.query.resource === collection ||
        (s.flatInclude && s.flatInclude.includes(collection))
      ) {
        // TODO implement incremental computing
        const queryHash = hash(s.query);
        const oldResult = this.querySnapshots[queryHash];
        const newResult = this.get(s.query, undefined, true);

        if (fastDeepEqual(newResult, oldResult)) return;

        this.querySnapshots[queryHash] = newResult;

        s.callbacks.forEach((cb) => {
          cb(newResult);
        });
      }
    });
  }
}
