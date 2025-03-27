import { useStore } from "@repo/live-state/client";
import { client, counterStore } from "./live-client";

export function LiveComponent(): JSX.Element {
  const counters = useStore(counterStore);

  return (
    <>
      <div>value: {JSON.stringify(counters)}</div>{" "}
      <button
        onClick={() => {
          if (!counters[0]) {
            client.counters.insert({ id: 0, counter: 1 });
            return;
          }

          client.counters.update({
            value: { counter: counters[0].counter + 1 },
            where: { id: 0 },
          });
        }}
        type="button"
      >
        Add 1
      </button>
    </>
  );
}
