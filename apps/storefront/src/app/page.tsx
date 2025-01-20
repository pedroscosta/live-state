"use client";

import type { ClientMessage, number } from "@repo/live-state";
import { log } from "@repo/logger";
import { CounterButton } from "@repo/ui/counter-button";
import { Link } from "@repo/ui/link";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

export default function Store(): JSX.Element {
  const [count, _setCount] = useState<z.infer<typeof number>>({
    value: 0,
    _metadata: { timestamp: new Date().toISOString() },
  });
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (socket.current) return;

    socket.current = new WebSocket("ws://localhost:5001/ws");

    socket.current.addEventListener("message", (event) => {
      log("Message received from the server:", event.data);

      const eventData = JSON.parse(event.data);

      if (eventData.type === "MUTATE") {
        const { shape, mutations } = eventData;

        console.log("Mutations received", mutations);

        if (shape === "counter") {
          _setCount(mutations[0]);
        }
      }
    });

    socket.current.addEventListener("open", (event) => {
      log("WebSocket connection opened");
      socket.current?.send(
        JSON.stringify({
          _id: nanoid(),
          type: "SUBSCRIBE",
          shape: "counter",
        } satisfies ClientMessage)
      );
    });
  }, []);

  const setCount: typeof _setCount = (value) => {
    const computedValue = typeof value === "function" ? value(count) : value;
    socket.current?.send(
      JSON.stringify({
        _id: nanoid(),
        type: "MUTATE",
        shape: "counter",
        mutations: [computedValue],
      } satisfies ClientMessage)
    );
    _setCount(computedValue);
  };

  return (
    <div className="container">
      <h1 className="title">
        Store <br />
        <span>Kitchen Sink</span>
      </h1>
      {count.value}
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
      </button>
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
