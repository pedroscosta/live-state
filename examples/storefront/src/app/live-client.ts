import { type Router, schema } from "@repo/ls-impl";
import { createClient } from "live-state/client";

export const { store, client } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
});

// export const { useLiveData, useSubscribe } = reactiveClient(client);
