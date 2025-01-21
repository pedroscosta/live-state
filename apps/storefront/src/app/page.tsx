"use client";

import { createClient } from "@repo/live-state/client";
import { Router } from "@repo/ls-impl";
import { CounterButton } from "@repo/ui/counter-button";
import { Link } from "@repo/ui/link";

const client = createClient<Router>({
  url: "ws://localhost:5001/ws",
});

const counterStore = client.counter.createStore({
  value: 0,
  _metadata: { timestamp: new Date().toISOString() },
});

console.log("Running");

export default function Store(): JSX.Element {
  const onClick = () => {
    console.log(counterStore.get());
  };

  return (
    <div className="container">
      <h1 className="title">
        Store <br />
        <span>Kitchen Sink</span>
      </h1>
      <button onClick={onClick}>Log store state</button>
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
