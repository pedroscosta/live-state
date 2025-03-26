"use client";

import { CounterButton } from "@repo/ui/counter-button";
import { Link } from "@repo/ui/link";
import { LiveComponent } from "./component";

export default function Store(): JSX.Element {
  return (
    <div className="container">
      <LiveComponent />
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
