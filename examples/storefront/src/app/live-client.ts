import { createClient } from "@live-state/sync/client";
import { type Router } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";
import { LogLevel } from "@live-state/sync";

export const { store, client } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
  storage: false,
  logLevel: LogLevel.DEBUG,
});
