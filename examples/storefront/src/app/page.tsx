"use client";

import { Switch } from "@/components/ui/switch";
import { useLoadData } from "@live-state/sync/client";
import { useSyncExternalStore } from "react";
import { Board } from "./board";
import { DndProvider } from "./dnd-context";
import { client, store } from "./live-client";

export default function Store(): JSX.Element {
  // Load via a custom query procedure (returns an unresolved builder server-side),
  // instead of the default collection query. Data still lands in the `groups`
  // store, so Board's `useLiveQuery(store.query.groups)` renders it as usual.
  useLoadData(client, store.query.groups.listGroups());

  const isConnected = useSyncExternalStore(
    (cb) => {
      client.ws.addEventListener("connectionChange", cb);
      return () => {
        client.ws.removeEventListener("connectionChange", cb);
      };
    },
    () => client.ws.connected()
  );

  return (
      <DndProvider>
        <header className="w-full h-16 flex items-center justify-end gap-2 p-2 border-b">
          <div className="flex items-center gap-2">
            Connected
            <Switch
              checked={isConnected}
              onCheckedChange={(v) =>
                v ? client.ws.connect() : client.ws.disconnect()
              }
            />
          </div>
        </header>
        <Board />
      </DndProvider>
  );
}
