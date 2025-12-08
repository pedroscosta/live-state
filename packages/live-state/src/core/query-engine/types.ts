import type { RawQueryRequest } from "../schemas/core-protocol";
import type { PromiseOrSync } from "../utils";

export interface DataSource {
  get(query: RawQueryRequest): PromiseOrSync<any[]>;
}

export interface QueryStep {
  query: RawQueryRequest;
  stepPath: string[];
}

export interface DataRouter<Context> extends DataSource {
  incrementQueryStep(step: QueryStep, context: Context): QueryStep;
}
