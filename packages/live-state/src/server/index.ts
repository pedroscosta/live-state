import { AnyShape, number, table } from "../schema";

export * from "./procedures";
export * from "./web-socket";

export type RouteRecord = Record<string, Route<AnyShape>>;

export type RouterDef<TRoutes extends RouteRecord> = {
  routes: TRoutes;
};

export const router = <TRoutes extends RouteRecord>(opts: {
  routes: TRoutes;
}): RouterDef<TRoutes> => {
  {
    return opts;
  }
};

export type AnyRouter = RouterDef<RouteRecord>;

export class Route<TShape extends AnyShape> {
  readonly shape: TShape;

  public constructor(shape: TShape) {
    this.shape = shape;
  }
}

export const routeFactory = () => {
  return <T extends AnyShape>(shape: T) => new Route<T>(shape);
};

export type AnyRoute = Route<AnyShape>;

/**
 * ##########################################################################
 * TESTING AREA
 * ##########################################################################
 */

const counters = table({
  counter: number(),
});

const publicRoute = routeFactory();

const _router = router({
  routes: {
    counters: publicRoute(counters),
  },
});
