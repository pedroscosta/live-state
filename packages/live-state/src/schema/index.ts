import {
  InferIndex,
  InferLiveType,
  LiveType,
  LiveTypeAny,
  LiveTypeMeta,
  MutationType,
} from "./live-type";

export * from "./atomic-types";
export * from "./live-type";

type InferLiveObjectWithoutRelations<T extends LiveObjectAny> = {
  [K in keyof T["fields"]]: InferLiveType<T["fields"][K]>;
};

export type InferLiveObject<T extends LiveObjectAny> =
  InferLiveObjectWithoutRelations<T> & {
    [K in keyof T["relations"]]: T["relations"][K]["type"] extends "one"
      ? InferLiveObject<T["relations"][K]["entity"]>
      : InferLiveObject<T["relations"][K]["entity"]>[];
  };

export type InferLiveObjectWithRelationalIds<T extends LiveObjectAny> =
  InferLiveObjectWithoutRelations<T> & {
    [K in keyof T["relations"]]: T["relations"][K]["type"] extends "one"
      ? InferIndex<T["relations"][K]["entity"]>
      : InferIndex<T["relations"][K]["entity"]>[];
  };

export type LiveObjectMutation<TSchema extends LiveObjectAny> = {
  value: Partial<InferLiveObjectWithRelationalIds<TSchema>>;
  where?: Record<string, any>; // TODO Infer indexable types
};

export type LiveObjectInsertMutation<TObject extends LiveObjectAny> = {
  value: InferLiveObjectWithRelationalIds<TObject>;
};

export type LiveObjectUpdateMutation<TObject extends LiveObjectAny> = {
  value: Partial<InferLiveObjectWithRelationalIds<TObject>>;
  id: string;
};

type MutationUnion<TObject extends LiveObject<any, any>> =
  | LiveObjectInsertMutation<TObject>
  | LiveObjectUpdateMutation<TObject>;

export class LiveObject<
  TSchema extends Record<string, LiveTypeAny>,
  TRelations extends Record<string, Relation<LiveObjectAny, any>>,
> extends LiveType<
  TSchema,
  LiveTypeMeta,
  MutationUnion<LiveObject<TSchema, TRelations>>,
  Record<string, any>
> {
  public readonly name: string;
  public readonly fields: TSchema;
  public readonly relations: TRelations;

  constructor(name: string, fields: TSchema, relations?: TRelations) {
    super();
    this.name = name;
    this.fields = fields;
    this.relations = relations ?? ({} as TRelations);
  }

  encodeMutation(
    mutationType: MutationType,
    input: MutationUnion<this>,
    timestamp: string
  ): Record<string, any> {
    if (mutationType === "set") throw new Error("Method not implemented.");

    return Object.fromEntries(
      Object.entries(input.value).map(([key, value]) => [
        key,
        (this.fields[key] ?? this.relations[key]).encodeMutation(
          "set",
          value,
          timestamp
        ),
      ])
    );
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutations: Record<string, any>,
    materializedShape?: MaterializedLiveType<this> | undefined
  ): [MaterializedLiveType<this>, Record<string, any> | null] {
    if (mutationType === "update" && !materializedShape)
      throw new Error("Missing previous value");

    const acceptedMutations: Record<string, any> = {};

    return [
      {
        value: {
          ...(materializedShape?.value ?? {}),
          ...Object.fromEntries(
            Object.entries(encodedMutations).map(([key, value]) => {
              const [newValue, acceptedValue] = (
                this.fields[key] ?? this.relations[key]
              ).mergeMutation(
                mutationType,
                value,
                materializedShape?.value[
                  key
                ] as MaterializedLiveType<LiveTypeAny>
              );

              if (acceptedValue) acceptedMutations[key] = acceptedValue;

              return [key, newValue];
            })
          ),
        },
      } as MaterializedLiveType<this>,
      acceptedMutations,
    ];
  }

  setRelations<TRelations extends Record<string, Relation<LiveObjectAny, any>>>(
    relations: TRelations
  ) {
    return new LiveObject(this.name, this.fields, relations);
  }

  static create<TSchema extends Record<string, LiveTypeAny>>(
    name: string,
    schema: TSchema
  ) {
    return new LiveObject<TSchema, never>(name, schema);
  }
}

export const object = LiveObject.create;

export type LiveObjectAny = LiveObject<Record<string, LiveTypeAny>, any>;

export class Relation<
  TEntity extends LiveObjectAny,
  TType extends "one" | "many",
> extends LiveType<
  InferIndex<TEntity>,
  {
    timestamp: string;
  } & LiveTypeMeta
> {
  public readonly entity: TEntity;
  public readonly type: TType;
  public readonly required: boolean;

  constructor(entity: TEntity, type: TType, required: boolean = false) {
    super();
    this.entity = entity;
    this.type = type;
    this.required = required;
  }
  encodeMutation(
    mutationType: MutationType,
    input: string,
    timestamp: string
  ): string {
    console.log("Encoding mutation", mutationType, input, timestamp);
    if (mutationType !== "set")
      throw new Error("Mutation type not implemented.");
    if (this.type === "many") throw new Error("Many not implemented.");

    return `${input};${timestamp}`;
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: string,
    materializedShape?:
      | { value: string; _meta: { timestamp: string } }
      | undefined
  ): [{ value: string; _meta: { timestamp: string } }, string | null] {
    console.log(
      "Merging mutation",
      mutationType,
      encodedMutation,
      materializedShape
    );
    if (this.type === "many") throw new Error("Many not implemented.");

    const [value, ts] = encodedMutation.split(";");

    if (materializedShape && materializedShape.value.localeCompare(ts) >= 0)
      return [materializedShape, null];

    return [
      {
        value: value,
        _meta: {
          timestamp: ts,
        },
      },
      encodedMutation,
    ];
  }
}

export const relations = <
  TRelationRecord extends Record<string, Relation<LiveObjectAny, any>>,
>(
  liveObject: LiveObjectAny,
  relationCreator: (types: {
    one: <TEntity extends LiveObjectAny>(
      entity: TEntity,
      opts?: { required: boolean }
    ) => Relation<TEntity, "one">;
    many: <TEntity extends LiveObjectAny>(
      entity: TEntity,
      opts?: { required: boolean }
    ) => Relation<TEntity, "many">;
  }) => TRelationRecord
) => {
  return {
    resource: liveObject.name,
    relations: relationCreator({
      one: (entity, opts) => new Relation(entity, "one", opts?.required),
      many: (entity, opts) => new Relation(entity, "many", opts?.required),
    }),
  };
};

export const createSchema = <
  TEntity extends LiveObjectAny,
  TRelations extends ReturnType<typeof relations>,
>(definition: {
  entities: TEntity[];
  relations: TRelations[];
}): Array<
  TEntity extends LiveObject<infer TSchema, any>
    ? LiveObject<TSchema, TRelations["relations"]>
    : never
> => {
  return definition.entities.map((entity) => {
    const relationsDef = definition.relations.find(
      (def) => def.resource === entity.name
    );

    if (!relationsDef) {
      return entity as any;
    }

    return entity.setRelations(relationsDef.relations) as any;
  });
};

export type MaterializedLiveType<T extends LiveTypeAny> =
  keyof T["_meta"] extends never
    ? {
        value: T["_value"] extends Record<string, LiveTypeAny>
          ? {
              [K in keyof T["_value"]]: MaterializedLiveType<T["_value"][K]>;
            }
          : T["_value"];
      }
    : {
        value: T["_value"] extends Record<string, LiveTypeAny>
          ? {
              [K in keyof T["_value"]]: MaterializedLiveType<T["_value"][K]>;
            }
          : T["_value"];
        _meta: T["_meta"];
      };

export type MaterializedLiveObject<T extends LiveObjectAny> =
  MaterializedLiveType<T> & {
    [K in keyof T["relations"]]: InferIndex<T["relations"][K]["entity"]>;
  };

export const inferValue = <T extends LiveTypeAny>(
  type: MaterializedLiveType<T>
): InferLiveType<T> => {
  if (typeof type.value !== "object") return type.value;

  return Object.fromEntries(
    Object.entries(type.value).map(([key, value]) => [
      key,
      inferValue(value as any),
    ])
  ) as InferLiveType<T>;
};

// ////////////////////////////////// testing

// const user = object("user", {
//   email: string(),
// });

// const comment = object("comment", {
//   text: string(),
// });

// const issue = object("issue", {
//   name: string(),
// }).setRelations({
//   creator: new Relation(user, "one", true),
//   comments: new Relation(comment, "many", true),
// });

// // const issueRelations = relations(issue, ({ one, many }) => ({
// //   creator: one(user),
// //   comments: many(comment),
// // }));

// // const schema = createSchema({
// //   entities: [user, issue, comment],
// // });

export type Schema = {
  entities: LiveObjectAny[];
};

// const publicRoute = routeFactory();

// export const routerImpl = router({
//   routes: {
//     user: publicRoute(user),
//     issue: publicRoute(issue),
//   },
// });

// export type Router = typeof routerImpl;

// // const { client: client1, store: store1 } = createClient<Router>({
// //   url: "ws://localhost:5001/ws",
// //   schema,
// // });

// const { client: client2, store: store2 } = createClient<Router>({
//   url: "ws://localhost:5001/ws",
//   schema: {
//     entities: [user, issue],
//   },
// });

// store2.issue.test.creator.email;
