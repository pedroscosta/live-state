"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SubscriptionProvider } from "@live-state/sync/client";
import { useSyncExternalStore } from "react";
import { DndProvider } from "./dnd-context";
import { client, store } from "./live-client";

export default function Store(): JSX.Element {
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
    <SubscriptionProvider client={client}>
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
        <Button
          onClick={() =>
            console.log(store.query.groups.where({ name: "New Group 1" }).get())
          }
        >
          Add Group
        </Button>
        {/* <Board /> */}
      </DndProvider>
    </SubscriptionProvider>
  );
}
