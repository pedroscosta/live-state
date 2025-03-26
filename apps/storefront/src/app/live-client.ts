import { createClient } from "@repo/live-state/client";
import { type Router, schema } from "@repo/ls-impl";

export const client = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
});

export const counterStore = client.counters.createStore();
