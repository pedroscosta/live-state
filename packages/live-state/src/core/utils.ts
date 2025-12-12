import { ulid } from "ulid";
import type { LiveObjectAny, WhereClause } from "../schema";

export const generateId = () => ulid().toLowerCase();

export type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>;

export type ConditionalPromise<T, P extends boolean> = P extends true
  ? Promise<T>
  : T;

/**
 * Creates a synchronous promise-like wrapper that provides Promise API (then)
 * but executes synchronously for immediate values.
 */
const createSyncPromise = <T>(value: T): PromiseLike<T> => {
  return {
    // biome-ignore lint/suspicious/noThenProperty: Intentionally creating a promise-like object with synchronous resolution
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ): PromiseLike<TResult1 | TResult2> {
      try {
        if (onfulfilled) {
          const result = onfulfilled(value);
          if (result instanceof Promise) {
            return result;
          }
          return createSyncPromise(result as TResult1);
        }
        return createSyncPromise(value as unknown as TResult1);
      } catch (error) {
        if (onrejected) {
          const result = onrejected(error);
          if (result instanceof Promise) {
            return result;
          }
          return createSyncPromise(result as TResult2);
        }
        throw error;
      }
    },
  };
};

/**
 * Wraps a value into a Promise-like API. If the value is already a Promise,
 * it returns it as-is. If it's a synchronous value, it wraps it in a SyncPromise
 * that provides then method but executes synchronously.
 */
export const toPromiseLike = <T>(value: T | Promise<T>): PromiseLike<T> => {
  if (value instanceof Promise) {
    return value;
  }
  return createSyncPromise(value);
};

export type PromiseOrSync<T> = T | Promise<T>;

export type Generatable<T, Arg = never> = T | ((arg: Arg) => T);

export const consumeGeneratable = <T, Arg = never>(
  value: Generatable<T, Arg>,
  arg?: Arg
): T => {
  return typeof value === "function"
    ? (value as (arg: Arg) => T)(arg as Arg)
    : value;
};

export const mergeWhereClauses = <T extends LiveObjectAny>(
  ...whereClauses: (WhereClause<T> | undefined | null)[]
): WhereClause<T> => {
  const filteredWhereClauses = whereClauses.filter(
    (wc): wc is WhereClause<T> => !!wc
  );

  if (filteredWhereClauses.length === 0) return {};
  if (filteredWhereClauses.length === 1) return filteredWhereClauses[0];
  return {
    $and: filteredWhereClauses,
  };
};
