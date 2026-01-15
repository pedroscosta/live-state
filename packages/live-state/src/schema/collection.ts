import {
	LiveType,
	type LiveTypeAny,
	type BaseMeta,
	type MutationType,
	type StorageFieldType,
	type MaterializedLiveType,
} from "./types";
import {
	Relation,
	type RelationAny,
	type RelationConnectors,
	type LiveCollectionAny as ILiveCollectionAny,
} from "./relations";

/**
 * Mutation input type for collections.
 */
export type LiveCollectionMutationInput<TSchema extends LiveCollectionAny> =
	Partial<{
		[K in keyof TSchema["fields"]]: TSchema["fields"][K]["_value"];
	}>;

/**
 * Configuration object for creating a collection with inline relations.
 */
export type CollectionConfig<
	TName extends string,
	TFields extends Record<string, LiveTypeAny>,
	TRelations extends Record<string, RelationAny> = Record<string, never>,
> = {
	fields: TFields;
	relations?: (
		connectors: RelationConnectors<LiveCollection<TName, TFields, any>>
	) => TRelations;
};

/**
 * Represents a collection of entities with fields and relations.
 *
 * @template TName - The collection name (used as resource identifier)
 * @template TFields - The field schema
 * @template TRelations - The relations schema
 */
export class LiveCollection<
	TName extends string,
	TFields extends Record<string, LiveTypeAny>,
	TRelations extends Record<string, RelationAny>,
> extends LiveType<
	TFields,
	BaseMeta,
	LiveCollectionMutationInput<any>,
	Record<string, MaterializedLiveType<LiveTypeAny>>
> {
	public readonly name: TName;
	public readonly fields: TFields;
	public readonly relations: TRelations;

	constructor(name: TName, fields: TFields, relations?: TRelations) {
		super();
		this.name = name;
		this.fields = fields;
		this.relations = relations ?? ({} as TRelations);
	}

	encodeMutation(
		_mutationType: MutationType,
		input: LiveCollectionMutationInput<this>,
		timestamp: string
	): Record<string, any> {
		return Object.fromEntries(
			Object.entries(input).map(([key, value]) => [
				key,
				(
					(this.fields as Record<string, LiveTypeAny>)[key] ??
					(this.relations as Record<string, RelationAny>)[key]
				).encodeMutation("set", value, timestamp),
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
							const field =
								(this.fields as Record<string, LiveTypeAny>)[key] ??
								(this.relations as Record<string, RelationAny>)[key];

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

	/**
	 * Returns a new collection with the given relations attached.
	 */
	setRelations<TNewRelations extends Record<string, RelationAny>>(
		relations: TNewRelations
	) {
		return new LiveCollection<this["name"], this["fields"], TNewRelations>(
			this.name,
			this.fields,
			relations
		);
	}

	getStorageFieldType(): StorageFieldType {
		throw new Error("Method not implemented.");
	}

	/**
	 * Creates a new collection with fields only.
	 */
	static create<TName extends string, TFields extends Record<string, LiveTypeAny>>(
		name: TName,
		fields: TFields
	): LiveCollection<TName, TFields, Record<string, never>>;

	/**
	 * Creates a new collection with fields and inline relations.
	 */
	static create<
		TName extends string,
		TFields extends Record<string, LiveTypeAny>,
		TRelations extends Record<string, RelationAny>,
	>(
		name: TName,
		config: CollectionConfig<TName, TFields, TRelations>
	): LiveCollection<TName, TFields, TRelations>;

	static create<
		TName extends string,
		TFields extends Record<string, LiveTypeAny>,
		TRelations extends Record<string, RelationAny> = Record<string, never>,
	>(
		name: TName,
		fieldsOrConfig: TFields | CollectionConfig<TName, TFields, TRelations>
	): LiveCollection<TName, TFields, TRelations> {
		if (isCollectionConfig(fieldsOrConfig)) {
			const config = fieldsOrConfig;
			const baseCollection = new LiveCollection<TName, TFields, Record<string, never>>(
				name,
				config.fields
			);

			if (config.relations) {
				const relations = config.relations({
					one: Relation.createOneFactory<
						LiveCollection<TName, TFields, any>
					>(),
					many: Relation.createManyFactory<
						LiveCollection<TName, TFields, any>
					>(),
				});
				return new LiveCollection<TName, TFields, TRelations>(
					name,
					config.fields,
					relations
				);
			}

			return baseCollection as LiveCollection<TName, TFields, TRelations>;
		}

		return new LiveCollection<TName, TFields, TRelations>(
			name,
			fieldsOrConfig as TFields,
			undefined
		);
	}
}

function isCollectionConfig<
	TName extends string,
	TFields extends Record<string, LiveTypeAny>,
	TRelations extends Record<string, RelationAny>,
>(
	value: TFields | CollectionConfig<TName, TFields, TRelations>
): value is CollectionConfig<TName, TFields, TRelations> {
	return (
		typeof value === "object" &&
		value !== null &&
		"fields" in value &&
		typeof value.fields === "object"
	);
}

/**
 * Creates a new collection.
 *
 * @example
 * ```ts
 * // Simple usage (fields only)
 * const users = collection('users', {
 *   id: id(),
 *   name: string(),
 * });
 *
 * // Full usage (fields + inline relations)
 * const posts = collection('posts', {
 *   fields: {
 *     id: id(),
 *     title: string(),
 *     authorId: reference('users.id'),
 *   },
 *   relations: ({ one, many }) => ({
 *     author: one(users, 'authorId'),
 *     comments: many(comments, 'postId'),
 *   }),
 * });
 * ```
 */
export const collection = LiveCollection.create;

export type LiveCollectionAny = LiveCollection<
	string,
	Record<string, LiveTypeAny>,
	any
>;

/** @deprecated Use `collection` instead */
export const object = collection;

/** @deprecated Use `LiveCollection` instead */
export const LiveObject = LiveCollection;

/** @deprecated Use `LiveCollectionAny` instead */
export type LiveObjectAny = LiveCollectionAny;

/** @deprecated Use `LiveCollectionMutationInput` instead */
export type LiveObjectMutationInput<TSchema extends LiveCollectionAny> =
	LiveCollectionMutationInput<TSchema>;

// Re-export with correct interface implementation
export const _ensureCollectionImplementsInterface: ILiveCollectionAny =
	{} as LiveCollectionAny;
