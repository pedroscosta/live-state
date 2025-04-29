import { createClient } from "@repo/live-state/client";
import { type Router, schema } from "@repo/ls-impl";

export const { store, client } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
});

// export const { useLiveData, useSubscribe } = reactiveClient(client);
