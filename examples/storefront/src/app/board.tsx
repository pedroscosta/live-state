// import { client, useLiveData, useSubscribe } from "./live-client";

import { useLiveQuery } from "@live-state/sync/client";
import { memo } from "react";
import { ulid } from "ulid";
import { Button } from "../../components/ui/button";
import { client } from "../../lib/fetch-client";
import { Group } from "./group";
import { store } from "./live-client";

const MemoItem = memo(Group);

export function Board(): JSX.Element {
  const groups = useLiveQuery(store.query.groups);

  return (
    <div className="p-2 flex flex-1 border overflow-y-hidden overflow-x-auto gap-6">
      {Object.values(groups ?? {}).map((group) => (
        <MemoItem key={group.id} groupId={group.id} />
      ))}
      <div className="flex flex-col gap-6">
        <Button
          className="w-sm"
          onClick={() => {
            store.mutate.groups.insert({
              id: ulid().toLowerCase(),
              name: `New Group ${Object.keys(groups ?? {}).length + 1}`,
            });
          }}
        >
          Add Group
        </Button>
        <Button
          className="w-sm"
          onClick={() => {
            client.mutate.groups.insert({
              id: ulid().toLowerCase(),
              name: `New Group ${Object.keys(groups ?? {}).length + 1} (fetch)`,
            });
          }}
        >
          Add Group (fetch)
        </Button>
        <Button
          className="w-sm"
          onClick={() => {
            client.query.groups.get().then((res) => {
              const group = Object.entries(res)[0];

              if (!group) {
                return;
              }

              client.mutate.groups.update(group[0], {
                name: `Updated Group ${Math.random().toString(36).substring(2, 15)} (fetch)`,
              });
            });
          }}
        >
          Update Group (fetch)
        </Button>
        <Button
          className="w-sm"
          onClick={() => {
            client.query.groups
              .include({ cards: { group: true } })
              .get()
              .then((res) => console.log("fetch", res));
            console.log("store", store.query.groups.include({ cards: { group: true } }).get());
          }}
        >
          Get Groups
        </Button>
        <Button
          className="w-sm"
          onClick={() => {
            client.mutate.groups.hello("Pedro").then((res) => console.log(res));
          }}
        >
          Custom mutation (fetch)
        </Button>
      </div>
    </div>
  );
}
