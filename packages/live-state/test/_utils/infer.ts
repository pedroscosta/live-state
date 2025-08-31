import { inferValue } from "../../src/schema";

export const inferRecord = <T extends Record<string, any>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).map(([key, value]) => [
      key,
      inferValue({ value, _meta: {} }),
    ])
  );
