import { routeFactory, router } from "../server";
import { Simplify } from "../utils";
import { LiveString, string } from "./atomic-types";
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

type InferRelationalColumns<T extends Record<string, RelationAny>> = {
  [K in keyof T as T[K] extends Relation<
    any,
    any,
    any,
    infer ColumnName,
    any,
    any
  >
    ? ColumnName extends string
      ? ColumnName
      : never
    : never]: T[K]["type"] extends "one"
    ? T[K] extends Relation<infer Entity, any, any, any, any, any>
      ? T[K]["required"] extends true
        ? InferIndex<Entity>
        : InferIndex<Entity> | undefined
      : never
    : never;
};

export type InferLiveObjectWithRelationalIds<T extends LiveObjectAny> =
  keyof T["relations"] extends string
    ? InferLiveObjectWithoutRelations<T> &
        InferRelationalColumns<T["relations"]>
    : InferLiveObjectWithoutRelations<T>;

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

export type MutationUnion<TObject extends LiveObject<any, any, any>> =
  | LiveObjectInsertMutation<TObject>
  | LiveObjectUpdateMutation<TObject>;

export class LiveObject<
  TName extends string,
  TSchema extends Record<string, LiveTypeAny>,
  TRelations extends Record<string, RelationAny>,
> extends LiveType<
  TSchema,
  LiveTypeMeta,
  MutationUnion<LiveObject<TName, TSchema, TRelations>>,
  Record<string, any>
> {
  public readonly name: TName;
  public readonly fields: TSchema;
  public readonly relations: TRelations;

  constructor(name: TName, fields: TSchema, relations?: TRelations) {
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

  setRelations<TRelations extends Record<string, RelationAny>>(
    relations: TRelations
  ) {
    return new LiveObject<this["name"], this["fields"], TRelations>(
      this.name,
      this.fields,
      relations
    );
  }

  static create<
    TName extends string,
    TSchema extends Record<string, LiveTypeAny>,
  >(name: TName, schema: TSchema) {
    return new LiveObject<TName, TSchema, never>(name, schema);
  }
}

export const object = LiveObject.create;

export type LiveObjectAny = LiveObject<
  string,
  Record<string, LiveTypeAny>,
  any
>;

export class Relation<
  TEntity extends LiveObjectAny,
  TSourceEntity extends LiveObjectAny,
  TType extends "one" | "many",
  TRelationalColumn extends keyof TSourceEntity["fields"],
  TForeignColumn extends keyof TEntity["fields"],
  TRequired extends boolean,
> extends LiveType<
  InferIndex<TEntity>,
  {
    timestamp: string;
  } & LiveTypeMeta
> {
  public readonly entity: TEntity;
  public readonly type: TType;
  public readonly required: TRequired;
  public readonly relationalColumn?: TRelationalColumn;
  public readonly foreignColumn?: TForeignColumn;
  public readonly sourceEntity!: TSourceEntity;

  private constructor(
    entity: TEntity,
    type: TType,
    column?: TRelationalColumn,
    foreignColumn?: TForeignColumn,
    required?: TRequired
  ) {
    super();
    this.entity = entity;
    this.type = type;
    this.required = (required ?? false) as TRequired;
    this.relationalColumn = column;
    this.foreignColumn = foreignColumn;
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
    materializedShape?: MaterializedLiveType<LiveString> | undefined
  ): [MaterializedLiveType<LiveString>, string | null] {
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

  static createOneFactory<TOriginEntity extends LiveObjectAny>() {
    return <
      TEntity extends LiveObjectAny,
      TColumn extends keyof TOriginEntity["fields"],
      TRequired extends boolean = false,
    >(
      entity: TEntity,
      column: TColumn,
      required?: TRequired
    ) => {
      return new Relation<
        TEntity,
        TOriginEntity,
        "one",
        TColumn,
        never,
        TRequired
      >(entity, "one", column, undefined, (required ?? false) as TRequired);
    };
  }

  static createManyFactory<TOriginEntity extends LiveObjectAny>() {
    return <
      TEntity extends LiveObjectAny,
      TColumn extends keyof TEntity["fields"],
      TRequired extends boolean = false,
    >(
      entity: TEntity,
      foreignColumn: TColumn,
      required?: TRequired
    ) => {
      return new Relation<
        TEntity,
        TOriginEntity,
        "many",
        never,
        TColumn,
        TRequired
      >(
        entity,
        "many",
        undefined,
        foreignColumn,
        (required ?? false) as TRequired
      );
    };
  }
}

type RelationAny = Relation<LiveObjectAny, LiveObjectAny, any, any, any, any>;

export const createRelations = <
  TSourceObject extends LiveObjectAny,
  TRelations extends Record<string, RelationAny>,
>(
  liveObject: TSourceObject,
  factory: (connectors: {
    one: ReturnType<typeof Relation.createOneFactory<TSourceObject>>;
    many: ReturnType<typeof Relation.createManyFactory<TSourceObject>>;
  }) => TRelations
): RelationsDecl<TSourceObject["name"], TRelations> => {
  return {
    $type: "relations",
    objectName: liveObject.name,
    relations: factory({
      one: Relation.createOneFactory<TSourceObject>(),
      many: Relation.createManyFactory<TSourceObject>(),
    }),
  };
};

// export const createSchema = <
//   TEntity extends LiveObjectAny,
//   TRelations extends ReturnType<typeof relations>,
// >(definition: {
//   entities: TEntity[];
//   relations: TRelations[];
// }): Array<
//   TEntity extends LiveObject<infer TSchema, any>
//     ? LiveObject<TSchema, TRelations["relations"]>
//     : never
// > => {
//   return definition.entities.map((entity) => {
//     const relationsDef = definition.relations.find(
//       (def) => def.resource === entity.name
//     );

//     if (!relationsDef) {
//       return entity as any;
//     }

//     return entity.setRelations(relationsDef.relations) as any;
//   });
// };

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
  if (Array.isArray(type.value))
    return (type.value as any[]).map((v) => inferValue(v)) as InferLiveType<T>;
  if (typeof type.value !== "object") return type.value;

  return Object.fromEntries(
    Object.entries(type.value).map(([key, value]) => [
      key,
      inferValue(value as any),
    ])
  ) as InferLiveType<T>;
};

type ExtractObjectValues<T> = T[keyof T];

type RelationsDecl<
  TObjectName extends string = string,
  TRelations extends Record<string, RelationAny> = Record<string, RelationAny>,
> = {
  $type: "relations";
  objectName: TObjectName;
  relations: TRelations;
};

type ParseRelationsFromSchema<
  TRawSchema extends RawSchema,
  TObjectName extends string,
> = ExtractObjectValues<{
  [K in keyof TRawSchema]: TRawSchema[K] extends RelationsDecl<
    infer TObjectName_,
    any
  >
    ? TObjectName_ extends TObjectName
      ? {
          [K2 in keyof TRawSchema[K]["relations"]]: Relation<
            ParseObjectFromSchema<
              TRawSchema,
              TRawSchema[K]["relations"][K2]["entity"]["name"]
            >,
            TRawSchema[K]["relations"][K2]["sourceEntity"],
            TRawSchema[K]["relations"][K2]["type"],
            Exclude<
              TRawSchema[K]["relations"][K2]["relationalColumn"],
              undefined
            >,
            Exclude<TRawSchema[K]["relations"][K2]["foreignColumn"], undefined>,
            TRawSchema[K]["relations"][K2]["required"]
          >;
        }
      : never
    : never;
}>;

type ParseObjectFromSchema<
  TRawSchema extends RawSchema,
  TObjectName extends string,
> = ExtractObjectValues<{
  [K in keyof TRawSchema]: TRawSchema[K] extends LiveObjectAny
    ? TRawSchema[K]["name"] extends TObjectName
      ? LiveObject<
          TRawSchema[K]["name"],
          TRawSchema[K]["fields"],
          ParseRelationsFromSchema<TRawSchema, TRawSchema[K]["name"]>
        >
      : never
    : never;
}>;

type RawSchema = Record<string, LiveObjectAny | RelationsDecl>;

export type Schema<TRawSchema extends RawSchema> = {
  [K in keyof TRawSchema as TRawSchema[K] extends LiveObjectAny
    ? TRawSchema[K]["name"]
    : never]: TRawSchema[K] extends LiveObjectAny
    ? ParseObjectFromSchema<TRawSchema, TRawSchema[K]["name"]>
    : never;
};

export const createSchema = <TRawSchema extends RawSchema>(
  schema: TRawSchema
): Schema<TRawSchema> => {
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) => {
      if ((value as RelationsDecl).$type === "relations") return [];

      let retVal = value as LiveObjectAny;
      const relDecl = Object.values(schema).find(
        (v) =>
          (v as RelationsDecl).$type === "relations" &&
          (v as RelationsDecl).objectName === (value as LiveObjectAny).name
      );

      if (relDecl) {
        retVal = retVal.setRelations(relDecl.relations);
      }

      return [[retVal.name, retVal]];
    })
  ) as Schema<TRawSchema>;
};

const post_ = object("post", {
  id: string(),
  title: string(),
});

const comment_ = object("comment", {
  id: string(),
  text: string(),
  postId: string(),
});

const postRelations = createRelations(post_, ({ many }) => ({
  comments: many(comment_, "postId"),
}));

// const commentRelations = createRelations(comment_, ({ one }) => ({
//   post: one(post_, "postId"),
// }));

const schema_ = createSchema({
  post_,
  comment_,
  postRelations,
  // commentRelations,
});

type test1 = (typeof schema_)["post"]["relations"]["comments"];
type test = Simplify<
  InferRelationalColumns<(typeof schema_)["comment"]["relations"]>
>;

const publicRoute = routeFactory();

const router_ = router({
  routes: {
    post: publicRoute(post_),
    comment: publicRoute(comment_),
  },
});

type b = (typeof schema_)["post"];
type c = (typeof schema_)["comment"];
type d = LiveObjectInsertMutation<b>;
type e = InferLiveObjectWithRelationalIds<c>;
type f = InferLiveObjectWithoutRelations<c>;
type g = InferRelationalColumns<c["relations"]>;
type h = keyof c["relations"] extends string ? true : false;

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
