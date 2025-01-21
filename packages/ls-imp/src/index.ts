import { number } from "@repo/live-state";
import { createRouter, route } from "@repo/live-state/server";

export const counter = number();

export const router = createRouter({
  counter: route(counter),
});

export type Router = typeof router;
