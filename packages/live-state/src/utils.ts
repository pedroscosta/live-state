import { xxHash32 } from "js-xxhash";
import type {
  IncludeClause,
  LiveObjectAny,
  Schema,
  WhereClause,
} from "./schema";

export type Simplify<T> =
  T extends Record<string, unknown>
    ? {
        [K in keyof T]: Simplify<T[K]>;
      }
    : T extends Array<infer U>
      ? Array<Simplify<U>>
      : T;

export const hash = (value: unknown) => {
  return xxHash32(JSON.stringify(value)).toString(32);
};

/**
 * Extracts include clauses from a where clause by finding all relation references
 */
export const extractIncludeFromWhere = (
  where: WhereClause<any>,
  resource: string,
  schema: Schema<any>
): IncludeClause<any> => {
  const include: any = {};

  const resourceSchema = schema[resource];

  if (!resourceSchema) {
    return include;
  }

  const processWhere = (w: WhereClause<any>) => {
    if (w.$and) {
      w.$and.forEach(processWhere);
    } else if (w.$or) {
      w.$or.forEach(processWhere);
    } else {
      Object.entries(w).forEach(([key, value]) => {
        // Check if this key is a relation
        if (resourceSchema.relations?.[key]) {
          include[key] = true;

          // If the value is a nested where clause, recursively extract includes
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            const nestedInclude = extractIncludeFromWhere(
              value as WhereClause<any>,
              resourceSchema.relations[key].entity.name,
              schema
            );

            // Only set nested include if it has any relations
            if (Object.keys(nestedInclude).length > 0) {
              include[key] = nestedInclude;
            }
          }
        }
      });
    }
  };

  processWhere(where);
  return include as IncludeClause<any>;
};

export const applyWhere = <T extends object>(
  obj: T,
  where: WhereClause<LiveObjectAny>,
  not = false
): boolean => {
  return Object.entries(where).every(([k, v]) => {
    if (k === "$and")
      return v.every((w: WhereClause<LiveObjectAny>) =>
        applyWhere(obj, w, not)
      );
    if (k === "$or")
      return v.some((w: WhereClause<LiveObjectAny>) => applyWhere(obj, w, not));

    const comparisonValue = v?.$eq !== undefined ? v?.$eq : v;

    if (typeof v === "object" && v !== null && v?.$eq === undefined) {
      // Handle $in operator
      if (v.$in !== undefined) {
        const value = obj[k as keyof T];
        if (value === undefined) {
          return false;
        }
        return not ? !v.$in.includes(value) : v.$in.includes(value);
      }

      // Handle $not operator
      if (v.$not !== undefined && !not)
        return applyWhere(obj, { [k]: v.$not }, true);

      // Handle $gt operator
      if (v.$gt !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value <= v.$gt : value > v.$gt;
      }

      // Handle $gte operator
      if (v.$gte !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value < v.$gte : value >= v.$gte;
      }

      // Handle $lt operator
      if (v.$lt !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value >= v.$lt : value < v.$lt;
      }

      // Handle $lte operator
      if (v.$lte !== undefined) {
        const value = obj[k as keyof T];
        if (typeof value !== "number") {
          return false;
        }
        return not ? value > v.$lte : value <= v.$lte;
      }

      // Handle nested objects
      const fieldValue = obj[k as keyof T];

      if (
        !fieldValue ||
        (typeof fieldValue !== "object" && !Array.isArray(fieldValue))
      )
        return false;

      // If the field is an array, check if any element matches the where clause
      if (Array.isArray(fieldValue)) {
        return not
          ? !fieldValue.some((item) => applyWhere(item as object, v, false))
          : fieldValue.some((item) => applyWhere(item as object, v, false));
      }

      return applyWhere(fieldValue as object, v, not);
    }

    return not
      ? obj[k as keyof T] !== comparisonValue
      : obj[k as keyof T] === comparisonValue;
  });
};

export const LogLevel = {
  CRITICAL: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type LogLevelName = keyof typeof LogLevel;

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /**
   * Minimum log level to display. Anything below this level will be muted.
   * @default LogLevel.INFO
   */
  level?: LogLevel;
  /**
   * Optional prefix to add to all log messages
   */
  prefix?: string;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ? `[${options.prefix}] ` : "";
  }

  // biome-ignore lint/suspicious/noExplicitAny: Logger accepts any args like console
  critical(...args: any[]): void {
    if (this.level >= LogLevel.CRITICAL) {
      console.error(`${this.prefix}[CRITICAL]`, ...args);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Logger accepts any args like console
  error(...args: any[]): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(`${this.prefix}[ERROR]`, ...args);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Logger accepts any args like console
  warn(...args: any[]): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(`${this.prefix}[WARN]`, ...args);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Logger accepts any args like console
  info(...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      console.log(`${this.prefix}[INFO]`, ...args);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Logger accepts any args like console
  debug(...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`${this.prefix}[DEBUG]`, ...args);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }
}

export const createLogger = (options?: LoggerOptions): Logger => {
  return new Logger(options);
};
