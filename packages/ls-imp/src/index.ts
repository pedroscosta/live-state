import { number } from "@repo/live-state";
import { createLiveStateRouter } from "@repo/live-state/server";

const shapes = { counter: number };

export const lsRouter = createLiveStateRouter<keyof typeof shapes>((query) => ({
  shapes,
  procedures: {
    getCounter: query("counter"),
  },
}));
