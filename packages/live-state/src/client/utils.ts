export const index = <T>(
  obj: T,
  indexes: Array<string | number | symbol>
): any =>
  indexes.reduce(
    (acc: any, key) => (acc && acc[key] !== undefined ? acc[key] : undefined),
    obj
  );
