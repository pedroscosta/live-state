import { createClient } from "@live-state/sync/client/fetch";
import { type Router } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";

export const client = createClient<Router>({
  url: "http://localhost:5001",
  schema,
});
