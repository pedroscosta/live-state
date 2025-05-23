// import { client, useLiveData, useSubscribe } from "./live-client";

import { useLiveQuery } from "@live-state/sync/client";
import { nanoid } from "nanoid";
import { memo } from "react";
import { Button } from "../../components/ui/button";
import { Group } from "./group";
import { store } from "./live-client";

const MemoItem = memo(Group);

export function Board(): JSX.Element {
  const groups = useLiveQuery(store.groups);

  return (
    <div className="p-2 flex flex-1 border overflow-y-hidden overflow-x-auto gap-6">
      {Object.values(groups ?? {}).map((group) => (
        <MemoItem key={group.id} groupId={group.id} />
      ))}
      <Button
        className="w-sm"
        onClick={() => {
          store.groups.insert({
            id: nanoid(),
            name: `New Group ${Object.keys(groups ?? {}).length + 1}`,
          });
        }}
      >
        Add Group
      </Button>
    </div>
  );
}
