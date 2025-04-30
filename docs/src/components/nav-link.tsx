"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NavLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      className={cn(
        "text-foreground/80 transition-colors hover:text-foreground",
        pathname.startsWith("/docs") ? "text-foreground" : ""
      )}
    >
      {children}
    </Link>
  );
};
