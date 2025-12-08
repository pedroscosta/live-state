/** biome-ignore-all lint/suspicious/noExplicitAny: no need to be more specific */

import type { Schema } from "../../schema";
import type { Storage } from "../../server";
import { Batcher } from "../../server/storage/batcher";
import { hash } from "../../utils";
import type {
  DefaultMutation,
  RawQueryRequest,
} from "../schemas/core-protocol";
import { toPromiseLike } from "../utils";
import type { DataRouter, DataSource, QueryStep } from "./types";

export type MutationHandler = (mutation: DefaultMutation) => void;

interface QueryNode {
  hash: string;
  queryStep: QueryStep;
  trackedObjects: Set<string>;
  subscriptions: Set<MutationHandler>;
  parentQuery?: string;
  relationName?: string;
  childQueries: Set<string>;
}

interface ObjectNode {
  id: string;
  type: string;
  matchedQueries: Set<string>;
  referencesObjects: Map<string, string>;
  referencedByObjects: Map<string, Set<string>>;
}

export class QueryEngine {
  private router: DataRouter<any>;
  private storage: DataSource;
  private schema: Schema<any>;
  private queryNodes: Map<string, QueryNode> = new Map();
  private objectNodes: Map<string, ObjectNode> = new Map();

  constructor(opts: {
    router: DataRouter<any>;
    storage: DataSource;
    schema: Schema<any>;
  }) {
    this.router = opts.router;
    this.storage = opts.storage;
    this.schema = opts.schema;
  }

  get(
    query: RawQueryRequest,
    extra?: { context?: any; batcher?: Batcher }
  ): PromiseLike<any[]> {
    const queryPlan = this.breakdownQuery({
      query,
      context: extra?.context ?? {},
    });
    return this.resolveQuery(queryPlan, {
      context: extra?.context ?? {},
      batcher: extra?.batcher ?? new Batcher(this.storage as Storage),
    });
  }

  subscribe(
    query: RawQueryRequest,
    callback: MutationHandler,
    context: any = {}
  ): () => void {
    const queryPlan = this.breakdownQuery({ query, context });

    const stepHashes: Record<string, string> = {};

    const unsubscribeFunctions: (() => void)[] = [];

    for (const step of queryPlan) {
      console.log("[QueryEngine] Subscribing to step", step.stepPath.join("."));

      const stepHash = hash(step);
      const lastStepHash = stepHashes[step.stepPath.at(-2) ?? ""];

      const currentRelationName = step.stepPath.at(-1) ?? "";

      const queryNode: QueryNode = {
        hash: stepHash,
        queryStep: step,
        relationName: currentRelationName,
        trackedObjects: new Set(),
        subscriptions: new Set([callback]),
        parentQuery: lastStepHash,
        childQueries: new Set(),
      };

      this.queryNodes.set(queryNode.hash, queryNode);

      if (lastStepHash) {
        const lastStepNode = this.queryNodes.get(lastStepHash);
        if (lastStepNode) {
          lastStepNode.childQueries.add(queryNode.hash);
        }
      }

      stepHashes[currentRelationName] = stepHash;

      unsubscribeFunctions.push(() => {
        const queryNode = this.queryNodes.get(stepHash);

        if (queryNode) {
          queryNode.subscriptions.delete(callback);

          if (queryNode.subscriptions.size === 0) {
            this.queryNodes.delete(stepHash);
          }
        }
      });
    }

    return () => {
      for (const unsubscribeFunction of unsubscribeFunctions) {
        unsubscribeFunction();
      }
    };
  }

  breakdownQuery({
    query,
    stepPath = [],
    context = {},
  }: {
    query: RawQueryRequest;
    stepPath?: string[];
    context?: any;
  }): QueryStep[] {
    const { include } = query;

    const newStep = this.router.incrementQueryStep(
      {
        query,
        stepPath: [...stepPath],
      },
      context
    );

    const queryPlan: QueryStep[] = [newStep];

    if (
      include &&
      typeof include === "object" &&
      Object.keys(include).length > 0
    ) {
      const resourceSchema = this.schema[query.resource];

      if (!resourceSchema)
        throw new Error(`Resource ${query.resource} not found`);

      queryPlan.push(
        ...Object.entries(include).flatMap(([relationName, include]) => {
          const relation = resourceSchema.relations[relationName];

          if (!relation)
            throw new Error(
              `Relation ${relationName} not found for resource ${query.resource}`
            );

          const otherResourceName = relation.entity.name;

          return this.breakdownQuery(
            // TODO pass nested queries down to the next step
            {
              query: { resource: otherResourceName, include },
              stepPath: [...stepPath, relationName],
              context,
            }
          );
        })
      );
    }

    return queryPlan;
  }

  resolveQuery(
    plan: QueryStep[],
    extra?: { context?: any; batcher?: Batcher }
  ): PromiseLike<any[]> {
    console.log(
      "[QueryEngine] Resolving query",
      plan.map((step) => step.stepPath.join(".")).join(" -> ")
    );

    const stepResults: Record<string, any[]> = {};

    let chain: PromiseLike<void> = this.resolveStep(plan[0], extra).then(
      (results) => {
        console.log(
          "[QueryEngine] Resolved step",
          plan[0].stepPath.join("."),
          "with results",
          JSON.stringify(results, null, 2)
        );
        stepResults[plan[0].stepPath.join(".")] = results;
      }
    );

    for (let i = 1; i < plan.length; i++) {
      const step = plan[i];

      chain = chain
        .then(() => this.resolveStep(step, extra))
        .then((results) => {
          console.log(
            "[QueryEngine] Resolved step",
            step.stepPath.join("."),
            "with results",
            JSON.stringify(results, null, 2)
          );
          stepResults[step.stepPath.join(".")] = results;
        });
    }

    chain = chain.then((() => {
      console.log(
        "[QueryEngine] Assembling results",
        JSON.stringify(stepResults, null, 2)
      );

      return stepResults[""];
    }) as () => void);

    return chain as unknown as PromiseLike<any[]>;
  }

  resolveStep(
    step: QueryStep,
    extra?: { context?: any; batcher?: Batcher }
  ): PromiseLike<any[]> {
    console.log(
      "[QueryEngine] Resolving step",
      step.stepPath.join("."),
      "with query",
      JSON.stringify(step.query, null, 2)
    );

    const { query } = step;

    return toPromiseLike(this.router.get(query, extra));
  }
}
