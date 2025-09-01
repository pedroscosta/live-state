import { InferLiveObject } from "@live-state/sync";
import { createClient } from "@live-state/sync/client";
import { type Router } from "@repo/ls-impl";
import { schema } from "@repo/ls-impl/schema";
import { Simplify } from "../../../../packages/live-state/src/utils";

export const { store, client } = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
  storage: {
    name: "storefront",
  },
});
type t = Simplify<InferLiveObject<typeof schema.groups>>;
type t2 = Router["routes"]["groups"]["_resourceSchema"];

const a = store.query.groups.get();
type t3 = (typeof store.query.groups)["_collection"];
store.query.groups
  .where({ name: "New Group 1" })
  .subscribe((v) => console.log("groups sub", JSON.stringify(v, null, 2)));
