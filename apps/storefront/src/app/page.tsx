"use client";

import { createClient, useStore } from "@repo/live-state/client";
import { router } from "@repo/ls-impl";
import { CounterButton } from "@repo/ui/counter-button";
import { Link } from "@repo/ui/link";

const client = createClient(router, {
  url: "ws://localhost:5001/ws",
});

const counterStore = client.counter.createStore(0);

console.log("Running");

export default function Store(): JSX.Element {
  const value = useStore(counterStore);

  const onClick = () => {
    console.log(counterStore.get());
  };

  return (
    <div className="container">
      <h1 className="title">
        Store <br />
        <span>Kitchen Sink</span>
      </h1>
      Value: {value} <br />
      {/* Metadata: {JSON.stringify(_metadata)} */}
      <button onClick={onClick}>Log store state</button>
      <button onClick={() => counterStore.mutate("set", 10)}>Set to 10</button>
      {/* {count.value}
      <button
        onClick={() =>
          setCount((s) => ({
            value: s.value + 1,
            _metadata: { timestamp: new Date().toISOString() },
          }))
        }
      >
        Increase
      </button>
      <button
        onClick={() =>
          setCount((s) => ({
            value: s.value - 1,
            _metadata: { timestamp: new Date().toISOString() },
          }))
        }
      >
        Decrease
      </button> */}
      {/* <button onClick={() => setCount((s) => s - 1)}>Decrease</button> */}
      <CounterButton />
      <p className="description">
        Built With{" "}
        <Link href="https://turbo.build/repo" newTab>
          Turborepo
        </Link>
        {" & "}
        <Link href="https://nextjs.org/" newTab>
          Next.js
        </Link>
      </p>
    </div>
  );
}
