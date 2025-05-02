import { Features } from "@/components/landing-page/features";
import { Separator } from "@/components/landing-page/separator";
import { Button } from "@/components/ui/button";
import { Spotlight } from "@/components/ui/spotlight-new";
import { Star } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <section
        id="hero"
        className="h-[40rem] w-ful antialiased bg-grid-white/[0.02] relative overflow-y-clip overflow-x-visible isolate"
      >
        <Spotlight
          className="absolute -left-1/4 -right-1/4 w-auto h-3/4"
          // height={1000}
          width={1000}
        />
        <div className="absolute size-full flex md:items-center md:justify-center border-x border-dashed z-[51]">
          <div className=" p-4 max-w-7xl mx-auto relative z-10 w-full pt-20 md:pt-0 flex flex-col items-center">
            <h1 className="text-4xl md:text-6xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400 bg-opacity-50 leading-tight max-w-3/4 mx-auto">
              Build ultra fast UIs without worrying about the data.
            </h1>
            <p className="mt-4 font-normal text-xl text-neutral-300 max-w-lg text-center mx-auto">
              Use the full power of a sync engine with the ease of a state
              management library.
            </p>
            <div className="mt-8 flex gap-4">
              <Button className="px-6 py-3" asChild>
                <Link href="/docs">Get started</Link>
              </Button>
              <Button className="px-6 py-3" asChild variant="outline">
                <Link href="https://github.com/pedroscosta/live-state">
                  Star on GitHub
                  <Star className="ml-2 h-4 w-4" />
                  {(async () => {
                    const response = await fetch(
                      "https://api.github.com/repos/pedroscosta/live-state"
                    );
                    const data = await response.json();
                    return data.stargazers_count;
                  })()}
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <div
          className="absolute w-screen h-32 bottom-0 z-50 -left-1/4 bg-gradient-to-t from-background via-transparent to-transparent pointer-events-none"
          aria-hidden="true"
        />
      </section>
      <Separator variant="outer" />
      <section id="features" className="-mt-[1px]">
        <Features />
      </section>
    </main>
  );
}
