import { AnyShape, number } from "../shape";

export * from "./web-socket";

export type RouteRecord = Record<string, Route<AnyShape, AnyMutation>>;

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

export type Mutation<T> = T;

export type AnyMutation = Mutation<any>;

export type MutationRecord = Record<string, AnyMutation>;

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
    const newRoute = new Route<TShape, TMutations>(this.shape, mutations);
    return newRoute;
  }

  static fromShape<TShape extends AnyShape>(shape: TShape) {
    return new Route(shape);
  }
}

export const route = Route.fromShape;

export type AnyRoute = Route<AnyShape, AnyMutation>;

/**
 * ##########################################################################
 * TESTING AREA
 * ##########################################################################
 */

const counter = number();

const test = createRouter({
  counter: route(counter),
});

type counter = (typeof test.routes)["counter"];
type counterMutations = counter["mutations"];
