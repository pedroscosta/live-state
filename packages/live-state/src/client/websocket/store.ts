import { DefaultMutationMessage } from "../../core/schemas/web-socket";
import {
  InferLiveType,
  inferValue,
  LiveObjectAny,
  LiveString,
  LiveTypeAny,
  MaterializedLiveType,
  Schema,
} from "../../schema";
import { GraphNode, ObjectGraph } from "../obj-graph";
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

  private resourceTypeSubscriptions: Record<string, Set<() => void>> = {};

  private kvStorage: KVStorage;

  public constructor(
    public readonly schema: Schema<any>,
    storageName: string,
    afterLoadMutations?: (stack: typeof this.optimisticMutationStack) => void
  ) {
    this.kvStorage = new KVStorage();

    this.kvStorage.init(this.schema, storageName).then(() => {
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

  public get(resourceType: string) {
    return Object.fromEntries(
      Object.entries(this.optimisticRawObjPool[resourceType] ?? {}).map(
        ([k, v]) => [k, inferValue(v)]
      )
    ) as Record<string, InferLiveType<LiveObjectAny>>;
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
                (r) => r[1].relationalColumn === k || r[1].foreignColumn === k
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

  public subscribe(path: string[], listener: () => void) {
    if (path.length === 1) {
      if (!this.resourceTypeSubscriptions[path[0]])
        this.resourceTypeSubscriptions[path[0]] = new Set();

      this.resourceTypeSubscriptions[path[0]].add(listener);

      return () => {
        this.resourceTypeSubscriptions[path[0]].delete(listener);
      };
    }

    if (path.length === 2) {
      const node = this.optimisticObjGraph.getNode(path[1]);

      if (!node) throw new Error("Node not found");

      return this.optimisticObjGraph.subscribe(path[1], listener);
    }

    throw new Error("Not implemented");
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
      (this.optimisticMutationStack[routeName] ??= []).push(mutation);
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
      (this.optimisticRawObjPool[routeName] ??= {})[mutation.resourceId] = {
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
          k.type === "many" ? [k.foreignColumn] : []
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
        if (!v || !schemaRelationalFields[k]) return;

        const prevRelation = prevValue?.value[
          k as keyof (typeof prevValue)["value"]
        ] as MaterializedLiveType<LiveString> | undefined;

        const [, updatedRelation] = schema.relations[
          schemaRelationalFields[k]
        ].mergeMutation(
          "set",
          v as { value: string; _meta: { timestamp: string } },
          prevRelation
        );

        if (!updatedRelation) return;

        if (!this.optimisticObjGraph.hasNode(updatedRelation.value)) {
          const otherNodeType =
            schema.relations[schemaRelationalFields[k]].entity.name;

          this.optimisticObjGraph.createNode(
            updatedRelation.value,
            otherNodeType,
            Object.values(this.schema[otherNodeType].relations).flatMap((r) =>
              r.type === "many" ? [r.foreignColumn] : []
            )
          );
        }

        if (prevRelation?.value) {
          this.optimisticObjGraph.removeLink(mutation.resourceId, k);
        }

        this.optimisticObjGraph.createLink(
          mutation.resourceId,
          updatedRelation.value,
          k
        );
      });
    }

    this.resourceTypeSubscriptions[routeName as string]?.forEach((listener) =>
      listener()
    );

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
}
