"use client";

import { createClient, useStore } from "@repo/live-state/client";
import { type Router, schema } from "@repo/ls-impl";
import { CounterButton } from "@repo/ui/counter-button";
import { Link } from "@repo/ui/link";
import { useEffect } from "react";

const client = createClient<Router>({
  url: "ws://localhost:5001/ws",
  schema,
});

const counterStore = client.counters.createStore();

console.log("Running");

export default function Store(): JSX.Element {
  const value = useStore(counterStore);

  useEffect(() => {
    // console.log(client.counters.insert);
    client.counters.insert({ id: 0, counter: 0 });
  }, []);

  const onClick = () => {
    console.log(counterStore.get());
  };

  return (
    <div className="container">
      <h1 className="title">
        Store <br />
        <span>Kitchen Sink</span>
      </h1>
      Value: {value as any} <br />
      {/* Metadata: {JSON.stringify(_metadata)} */}
      <button onClick={onClick} type="button">
        Log store state
      </button>
      <button
        onClick={() => {
          // client.counters.set({ counter: 10 });
        }}
        type="button"
      >
        Set to 10
      </button>
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
