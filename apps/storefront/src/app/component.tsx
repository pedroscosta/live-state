import { Button } from "@/components/ui/button";
import ReactJsonView from "@microlink/react-json-view";
import { useSyncExternalStore } from "react";
import { client, useLiveData, useSubscribe } from "./live-client";

export function LiveComponent(): JSX.Element {
  useSubscribe("counters");
  const counters = useLiveData((s) => s.counters);

  const raw = useSyncExternalStore(client.subscribeToState.bind(client), () =>
    client.getRaw()
  );

  return (
    <div className="p-2 grid grid-cols-2">
      <div className="flex items-center flex-col gap-4">
        <span>
          Value:{" "}
          <span className="whitespace-pre-wrap border rounded-md p-1 bg-muted">
            {counters?.[0]?.counter ?? 0}
          </span>
        </span>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (!counters?.[0]) {
                client.routes.counters.insert({ id: 0, counter: 1 });
                return;
              }
              client.routes.counters.update({
                value: { counter: counters?.[0].counter - 1 },
                where: { id: 0 },
              });
            }}
            type="button"
          >
            -1
          </Button>
          <Button
            onClick={() => {
              if (!counters?.[0]) {
                client.routes.counters.insert({ id: 0, counter: -1 });
                return;
              }
              client.routes.counters.update({
                value: { counter: counters?.[0].counter + 1 },
                where: { id: 0 },
              });
            }}
            type="button"
          >
            +1
          </Button>
        </div>
      </div>
      <ReactJsonView key={JSON.stringify(raw)} src={raw} />
    </div>
  );
}
