import { AnyShape, number } from "../shape";
import {
  AnyMutation,
  InjectedMutationRecord,
  MutationRecord,
  update,
} from "./procedures";

export * from "./procedures";
export * from "./web-socket";

export type RouteRecord = Record<
  string,
  Route<AnyShape, InjectedMutationRecord<MutationRecord, AnyShape>>
>;

export type RouterDef<TRoutes extends RouteRecord> = {
  routes: TRoutes;
};

export const createRouter = <TRoutes extends RouteRecord>(
  routes: TRoutes
): RouterDef<TRoutes> => {
  return {
    routes,
  };
};

export type AnyRouter = RouterDef<RouteRecord>;

export class Route<TShape extends AnyShape, TMutations extends MutationRecord> {
  readonly shape: TShape;
  readonly mutations: TMutations;

  private constructor(shape: TShape, mutations?: TMutations) {
    this.shape = shape;
    this.mutations = mutations ?? ({} as TMutations);
  }

  public withMutations<TMutations extends MutationRecord>(
    mutations: TMutations
  ) {
    const injectedMutations = Object.entries(mutations).reduce(
      (acc, [key, mutation]) => {
        acc[key] = mutation._input ? mutation : mutation.input(this.shape);
        return acc;
      },
      {} as Record<string, AnyMutation>
    ) as InjectedMutationRecord<TMutations, TShape>;

    const newRoute = new Route<
      TShape,
      InjectedMutationRecord<TMutations, TShape>
    >(this.shape, injectedMutations);
    return newRoute;
  }

  static fromShape<TShape extends AnyShape>(shape: TShape) {
    return new Route(shape);
  }
}

export const route = Route.fromShape;

export type AnyRoute = Route<AnyShape, MutationRecord>;

/**
 * ##########################################################################
 * TESTING AREA
 * ##########################################################################
 */

const counter = number();

const test = createRouter({
  counter: route(counter).withMutations({
    set: update(),
  }),
});
