import { ulid } from "ulid";
import type { LiveObjectAny, WhereClause } from "../schema";

export const generateId = () => ulid().toLowerCase();

export type Promisify<T> = T extends Promise<any> ? T : Promise<T>;

export type ConditionalPromise<T, P extends boolean> = P extends true
  ? Promise<T>
  : T;

export type Awaitable<T> = T | Promise<T>;

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
