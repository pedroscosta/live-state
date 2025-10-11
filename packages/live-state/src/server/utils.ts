import type { MaterializedLiveType } from "../schema";

export const setInMaterializedLiveType = (
  materializedLiveType: MaterializedLiveType<any>,
  path: string[],
  value: MaterializedLiveType<any>
) => {
  let current = materializedLiveType;
  for (const key of path) {
    current = current.value[key];
  }
  current = value;
};
