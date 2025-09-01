import { LiveString } from "./atomic-types";
import {
  InferIndex,
  InferLiveType,
  LiveType,
  LiveTypeAny,
  LiveTypeMeta,
  MutationType,
  StorageFieldType,
} from "./live-type";

export * from "./atomic-types";
export * from "./live-type";

type InferLiveObjectWithoutRelations<T extends LiveObjectAny> = {
  [K in keyof T["fields"]]: InferLiveType<T["fields"][K]>;
};

export type InferLiveObject<T extends LiveObjectAny> =
  InferLiveObjectWithoutRelations<T>;
//  & {
//   [K in keyof T["relations"]]: T["relations"][K]["type"] extends "one"
//     ? InferLiveObject<T["relations"][K]["entity"]>
//     : InferLiveObject<T["relations"][K]["entity"]>[];
// };

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

export type LiveObjectMutationInput<TSchema extends LiveObjectAny> = Partial<
  InferLiveObjectWithRelationalIds<TSchema>
>;

export class LiveObject<
  TName extends string,
  TSchema extends Record<string, LiveTypeAny>,
  TRelations extends Record<string, RelationAny>,
> extends LiveType<
  TSchema,
  LiveTypeMeta,
  LiveObjectMutationInput<any>,
  Record<string, MaterializedLiveType<LiveTypeAny>>
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
    _mutationType: MutationType,
    input: LiveObjectMutationInput<this>,
    timestamp: string
  ): Record<string, any> {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
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
    encodedMutations: Record<string, MaterializedLiveType<LiveTypeAny>>,
    materializedShape?: MaterializedLiveType<this> | undefined
  ): [MaterializedLiveType<this>, Record<string, any> | null] {
    const acceptedMutations: Record<string, any> = {};

    return [
      {
        value: {
          ...(materializedShape?.value ?? {}),
          ...Object.fromEntries(
            Object.entries(encodedMutations).map(([key, value]) => {
              const field = this.fields[key] ?? this.relations[key];

              if (!field) return [key, value];

              const [newValue, acceptedValue] = field.mergeMutation(
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

  getStorageFieldType(): StorageFieldType {
    throw new Error("Method not implemented.");
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
    timestamp: string | null;
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
  ): { value: string; _meta: { timestamp: string } } {
    if (mutationType !== "set")
      throw new Error("Mutation type not implemented.");
    if (this.type === "many") throw new Error("Many not implemented.");

    return {
      value: input,
      _meta: {
        timestamp,
      },
    };
  }

  mergeMutation(
    mutationType: MutationType,
    encodedMutation: { value: string; _meta: { timestamp: string } },
    materializedShape?: MaterializedLiveType<LiveString> | undefined
  ): [
    MaterializedLiveType<LiveString>,
    { value: string; _meta: { timestamp: string } } | null,
  ] {
    if (this.type === "many") throw new Error("Many not implemented.");

    if (
      materializedShape &&
      materializedShape._meta.timestamp &&
      encodedMutation._meta.timestamp &&
      materializedShape._meta.timestamp.localeCompare(
        encodedMutation._meta.timestamp
      ) >= 0
    )
      return [materializedShape, null];

    return [encodedMutation, encodedMutation];
  }

  getStorageFieldType(): StorageFieldType {
    return {
      type: "varchar",
      nullable: !this.required,
      references: `${this.entity.name}.${String(this.foreignColumn ?? this.relationalColumn ?? "id")}`,
    };
  }

  toJSON() {
    return {
      entityName: this.entity.name,
      type: this.type,
      required: this.required,
      relationalColumn: this.relationalColumn,
      foreignColumn: this.foreignColumn,
    };
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

export type MaterializedLiveType<T extends LiveTypeAny> = {
  value: T["_value"] extends Record<string, LiveTypeAny>
    ? {
        [K in keyof T["_value"]]: MaterializedLiveType<T["_value"][K]>;
      }
    : T["_value"];
  _meta: T["_meta"];
};

export const inferValue = <T extends LiveTypeAny>(
  type?: MaterializedLiveType<T>
): InferLiveType<T> | undefined => {
  if (!type) return undefined;

  if (Array.isArray(type.value))
    return (type.value as any[]).map((v) => inferValue(v)) as InferLiveType<T>;

  if (
    typeof type.value !== "object" ||
    type.value === null ||
    type.value instanceof Date
  )
    return type.value;

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

export type WhereClause<T extends LiveObjectAny> = {
  [K in keyof T["fields"]]?: InferLiveType<T["fields"][K]>;
} & {
  [K in keyof T["relations"]]?: WhereClause<T["relations"][K]["entity"]>;
};

export type IncludeClause<T extends LiveObjectAny> = {
  [K in keyof T["relations"]]?: boolean;
};
