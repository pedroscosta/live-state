import { LiveCollection, type LiveCollectionAny } from "./collection";
import { Relation, type RelationsDecl, type RelationAny } from "./relations";

type ExtractObjectValues<T> = T[keyof T];

type ParseRelationsFromSchema<
	TRawSchema extends RawSchema,
	TCollectionName extends string,
> = ExtractObjectValues<{
	[K in keyof TRawSchema]: TRawSchema[K] extends RelationsDecl<
		infer TCollectionName_,
		any
	>
		? TCollectionName_ extends TCollectionName
			? {
					[K2 in keyof TRawSchema[K]["relations"]]: Relation<
						ParseCollectionFromSchema<
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

type ParseCollectionFromSchema<
	TRawSchema extends RawSchema,
	TCollectionName extends string,
> = ExtractObjectValues<{
	[K in keyof TRawSchema]: TRawSchema[K] extends LiveCollectionAny
		? TRawSchema[K]["name"] extends TCollectionName
			? LiveCollection<
					TRawSchema[K]["name"],
					TRawSchema[K]["fields"],
					ParseRelationsFromSchema<TRawSchema, TRawSchema[K]["name"]>
				>
			: never
		: never;
}>;

type RawSchema = Record<string, LiveCollectionAny | RelationsDecl>;

/**
 * The final schema type with all collections and their relations resolved.
 */
export type Schema<TRawSchema extends RawSchema> = {
	[K in keyof TRawSchema as TRawSchema[K] extends LiveCollectionAny
		? TRawSchema[K]["name"]
		: never]: TRawSchema[K] extends LiveCollectionAny
		? ParseCollectionFromSchema<TRawSchema, TRawSchema[K]["name"]>
		: never;
};

/**
 * Creates a schema from a raw schema object.
 * Attaches relations to their corresponding collections.
 *
 * @example
 * ```ts
 * const schema = createSchema({
 *   users,
 *   userRelations,
 *   posts,
 *   postRelations,
 * });
 * ```
 */
export const createSchema = <TRawSchema extends RawSchema>(
	schema: TRawSchema
): Schema<TRawSchema> => {
	return Object.fromEntries(
		Object.entries(schema).flatMap(([key, value]) => {
			if ((value as RelationsDecl).$type === "relations") return [];

			let retVal = value as LiveCollectionAny;
			const relDecl = Object.values(schema).find(
				(v) =>
					(v as RelationsDecl).$type === "relations" &&
					(v as RelationsDecl).collectionName === (value as LiveCollectionAny).name
			);

			if (relDecl) {
				retVal = retVal.setRelations(
					(relDecl as RelationsDecl).relations
				) as LiveCollectionAny;
			}

			return [[retVal.name, retVal]];
		})
	) as Schema<TRawSchema>;
};
