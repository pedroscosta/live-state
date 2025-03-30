"use client";

import { Switch } from "@/components/ui/switch";
import { LiveComponent } from "./component";

export default function Store(): JSX.Element {
  return (
    <>
      <header className="w-full h-16 flex items-center justify-end gap-2 p-2 border-b">
        <div className="flex items-center gap-2">
          Connected
          <Switch />
        </div>
      </header>
      <LiveComponent />
    </>
  );
}
