import { createClient } from "@live-state/sync/client";
import { type Router } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";

export const { store, client } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
});

// export const { useLiveData, useSubscribe } = reactiveClient(client);
