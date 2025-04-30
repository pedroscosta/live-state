import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="flex flex-col max-w-7xl w-full border mx-auto h-[200vh]">
        {children}
      </main>
    </>
  );
}
