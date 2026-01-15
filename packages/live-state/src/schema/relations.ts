import {
	LiveType,
	type LiveTypeAny,
	type BaseMeta,
	type MutationType,
	type StorageFieldType,
	type MaterializedLiveType,
	type InferIndex,
} from "./types";
import type { LiveString } from "./atomic";

/**
 * Forward declaration for LiveCollection to avoid circular dependency.
 * The actual type is defined in collection.ts
 */
export interface LiveCollectionAny {
	readonly name: string;
	readonly fields: Record<string, LiveTypeAny>;
	readonly relations: Record<string, RelationAny>;
	setRelations<TRelations extends Record<string, RelationAny>>(
		relations: TRelations
	): LiveCollectionAny;
}

/**
 * Represents a relation between two collections.
 *
 * @template TEntity - The target collection
 * @template TSourceEntity - The source collection
 * @template TType - "one" for many-to-one, "many" for one-to-many
 * @template TRelationalColumn - The FK column on source (for "one" relations)
 * @template TForeignColumn - The FK column on target (for "many" relations)
 * @template TRequired - Whether the relation is required
 */
export class Relation<
	TEntity extends LiveCollectionAny,
	TSourceEntity extends LiveCollectionAny,
	TType extends "one" | "many",
	TRelationalColumn extends keyof TSourceEntity["fields"],
	TForeignColumn extends keyof TEntity["fields"],
	TRequired extends boolean,
> extends LiveType<
	InferIndex<TEntity extends LiveTypeAny ? TEntity : LiveTypeAny>,
	{
		timestamp: string | null;
	} & BaseMeta
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
		if (this.type === "many") {
			if (materializedShape) return [materializedShape, null];
			return [encodedMutation, encodedMutation];
		}

		if (
			materializedShape?._meta?.timestamp &&
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

	/**
	 * Creates a factory for many-to-one relations.
	 */
	static createOneFactory<TOriginEntity extends LiveCollectionAny>() {
		return <
			TEntity extends LiveCollectionAny,
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

	/**
	 * Creates a factory for one-to-many relations.
	 */
	static createManyFactory<TOriginEntity extends LiveCollectionAny>() {
		return <
			TEntity extends LiveCollectionAny,
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

export type RelationAny = Relation<
	LiveCollectionAny,
	LiveCollectionAny,
	any,
	any,
	any,
	any
>;

/**
 * Connectors for defining relations.
 */
export type RelationConnectors<TSourceEntity extends LiveCollectionAny> = {
	one: ReturnType<typeof Relation.createOneFactory<TSourceEntity>>;
	many: ReturnType<typeof Relation.createManyFactory<TSourceEntity>>;
};

/**
 * Declaration type for relations defined separately from collections.
 */
export type RelationsDecl<
	TCollectionName extends string = string,
	TRelations extends Record<string, RelationAny> = Record<string, RelationAny>,
> = {
	$type: "relations";
	collectionName: TCollectionName;
	/** @deprecated Use `collectionName` instead */
	objectName: TCollectionName;
	relations: TRelations;
};

/**
 * Creates a relations declaration for a collection.
 * Use this for circular dependencies or when defining relations separately.
 *
 * @example
 * ```ts
 * const userRelations = createRelations(users, ({ one, many }) => ({
 *   posts: many(posts, 'authorId'),
 *   profile: one(profile, 'profileId'),
 * }));
 * ```
 */
export const createRelations = <
	TSourceCollection extends LiveCollectionAny,
	TRelations extends Record<string, RelationAny>,
>(
	collection: TSourceCollection,
	factory: (connectors: RelationConnectors<TSourceCollection>) => TRelations
): RelationsDecl<TSourceCollection["name"], TRelations> => {
	return {
		$type: "relations",
		collectionName: collection.name,
		objectName: collection.name,
		relations: factory({
			one: Relation.createOneFactory<TSourceCollection>(),
			many: Relation.createManyFactory<TSourceCollection>(),
		}),
	};
};

/** @deprecated Use `RelationsDecl` instead (renamed for consistency) */
export type ObjectRelationsDecl<
	TObjectName extends string = string,
	TRelations extends Record<string, RelationAny> = Record<string, RelationAny>,
> = RelationsDecl<TObjectName, TRelations> & { objectName: TObjectName };
