/** biome-ignore-all lint/suspicious/noExplicitAny: any is actually used correctly */
import type { Expression, Kysely, RawBuilder, Simplify } from "kysely";
import {
  jsonArrayFrom as mysqlJsonArrayFrom,
  jsonObjectFrom as mysqlJsonObjectFrom,
} from "kysely/helpers/mysql";
import {
  jsonArrayFrom as postgresJsonArrayFrom,
  jsonObjectFrom as postgresJsonObjectFrom,
} from "kysely/helpers/postgres";
import {
  jsonArrayFrom as sqliteJsonArrayFrom,
  jsonObjectFrom as sqliteJsonObjectFrom,
} from "kysely/helpers/sqlite";

export type SupportedDialect = "postgres" | "mysql" | "sqlite";

type JsonObjectFromFn = <O>(
  expr: Expression<O>
) => RawBuilder<Simplify<O> | null>;

type JsonArrayFromFn = <O>(expr: Expression<O>) => RawBuilder<Simplify<O>[]>;

export interface DialectHelpers {
  jsonObjectFrom: JsonObjectFromFn;
  jsonArrayFrom: JsonArrayFromFn;
}

const dialectHelpers: Record<SupportedDialect, DialectHelpers> = {
  postgres: {
    jsonObjectFrom: postgresJsonObjectFrom,
    jsonArrayFrom: postgresJsonArrayFrom,
  },
  mysql: {
    jsonObjectFrom: mysqlJsonObjectFrom as any,
    jsonArrayFrom: mysqlJsonArrayFrom as any,
  },
  sqlite: {
    jsonObjectFrom: sqliteJsonObjectFrom as any,
    jsonArrayFrom: sqliteJsonArrayFrom as any,
  },
};

/**
 * Detects the database dialect from a Kysely instance by inspecting the executor's adapter.
 *
 * @param db - The Kysely database instance
 * @returns The detected dialect, or 'postgres' as a fallback
 */
export function detectDialect(db: Kysely<any>): SupportedDialect {
  const executor = (db as any).getExecutor?.();
  const adapter = executor?.adapter;

  if (!adapter) {
    // Fallback to postgres if we can't detect
    return "postgres";
  }

  const adapterName = adapter.constructor?.name?.toLowerCase() ?? "";

  if (adapterName.includes("postgres")) {
    return "postgres";
  }
  if (adapterName.includes("mysql")) {
    return "mysql";
  }
  if (adapterName.includes("sqlite")) {
    return "sqlite";
  }

  // Default fallback
  return "postgres";
}

/**
 * Gets the appropriate JSON helper functions for the given Kysely database instance.
 *
 * @param db - The Kysely database instance
 * @returns Object containing jsonObjectFrom and jsonArrayFrom functions for the detected dialect
 */
export function getDialectHelpers(db: Kysely<any>): DialectHelpers {
  const dialect = detectDialect(db);
  return dialectHelpers[dialect];
}

/**
 * Gets the jsonObjectFrom helper for the given Kysely database instance.
 *
 * @param db - The Kysely database instance
 * @returns The jsonObjectFrom function for the detected dialect
 */
export function getJsonObjectFrom(db: Kysely<any>): JsonObjectFromFn {
  return getDialectHelpers(db).jsonObjectFrom;
}

/**
 * Gets the jsonArrayFrom helper for the given Kysely database instance.
 *
 * @param db - The Kysely database instance
 * @returns The jsonArrayFrom function for the detected dialect
 */
export function getJsonArrayFrom(db: Kysely<any>): JsonArrayFromFn {
  return getDialectHelpers(db).jsonArrayFrom;
}
