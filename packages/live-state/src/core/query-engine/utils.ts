import { hash } from "../../utils";
import type { QueryStep } from "./types";

export function hashStep(step: QueryStep): string {
  return hash({
    resource: step.query.resource,
    where: step.query.where,
    include: step.query.include,
    stepPath: step.stepPath,
    isMany: step.isMany,
    relationName: step.relationName,
  });
}
