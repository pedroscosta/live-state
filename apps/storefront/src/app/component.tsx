import { useStore } from "@repo/live-state/client";
import { client, counterStore } from "./live-client";

export function LiveComponent(): JSX.Element {
  const value = useStore(counterStore);

  return (
    <>
      <div>value: {JSON.stringify(value)}</div>{" "}
      <button
        onClick={() => {
          client.counters.insert({ id: 0, counter: 0 });
        }}
        type="button"
      >
        Set to 10
      </button>
    </>
  );
}
