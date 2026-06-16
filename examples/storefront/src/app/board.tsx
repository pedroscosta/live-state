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
      <div className="flex flex-col gap-2 w-sm shrink-0">
        {/* [OPTIMISTIC] new group appears instantly, confirmed ~2s later. */}
        <Button
          onClick={() => {
            store.mutate.groups.createGroup({
              id: ulid().toLowerCase(),
              name: `New Group ${Object.keys(groups ?? {}).length + 1}`,
            });
          }}
        >
          Add Group (optimistic)
        </Button>

        {/* [NON-OPTIMISTIC] same op over the fetch client, no optimism — the
            group only shows up after the server replies. */}
        <Button
          variant="outline"
          onClick={() => {
            client.mutate.groups.createGroup({
              id: ulid().toLowerCase(),
              name: `New Group ${Object.keys(groups ?? {}).length + 1} (fetch)`,
            });
          }}
        >
          Add Group (fetch, no optimism)
        </Button>

        {/* [NON-OPTIMISTIC] rename the first group — lags by the server delay. */}
        <Button
          variant="outline"
          onClick={() => {
            const first = Object.values(groups ?? {})[0];
            if (!first) return;
            store.mutate.groups.renameGroup({
              id: first.id,
              name: `Renamed ${Math.random().toString(36).substring(2, 8)}`,
            });
          }}
        >
          Rename first group (non-optimistic)
        </Button>

        <Button
          variant="secondary"
          onClick={() => {
            store.mutate.groups.seed();
          }}
        >
          Seed demo data
        </Button>

        <div className="mt-4 border-t pt-2 text-xs text-muted-foreground">
          Diagnostics
        </div>

        <Button
          variant="ghost"
          onClick={() => {
            store.query.groups.getStats().then((res) => {
              alert(
                `Stats:\nTotal Groups: ${res.totalGroups}\nTotal Cards: ${res.totalCards}\nGroups with Cards: ${res.groupsWithCards}\nAverage Cards per Group: ${res.averageCardsPerGroup}`,
              );
            });
          }}
        >
          Get Stats (ws query)
        </Button>

        <Button
          variant="ghost"
          onClick={() => {
            const searchTerm = prompt("Enter search term:");
            if (searchTerm) {
              store.query.groups.searchByName(searchTerm).then((res) => {
                const count = Object.keys(res).length;
                alert(`Found ${count} group(s) matching "${searchTerm}"`);
              });
            }
          }}
        >
          Search Groups (ws query)
        </Button>
      </div>
    </div>
  );
}
