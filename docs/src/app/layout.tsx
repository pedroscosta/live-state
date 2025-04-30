import { RootProvider } from "fumadocs-ui/provider";
import { RefreshCw } from "lucide-react";
import { Inter } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { NavLink } from "../components/nav-link";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <header className="border-b h-14 w-full sticky top-0 bg-background flex items-center px-12 py-2 font-mono z-50">
          <Link
            href="/"
            className="flex items-center gap-2  text-lg font-medium"
          >
            <RefreshCw className="rotate-90" /> live-state
          </Link>
          <div className="ml-auto">
            <NavLink href="/docs">docs</NavLink>
          </div>
        </header>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
