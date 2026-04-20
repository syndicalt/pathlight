"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Traces", match: (p: string) => p === "/" || p.startsWith("/traces") },
  { href: "/commits", label: "Commits", match: (p: string) => p.startsWith("/commits") },
];

export function TopNav() {
  const pathname = usePathname() || "/";

  return (
    <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-4">
        <Link href="/" className="text-base font-bold tracking-tight shrink-0">
          <span className="text-blue-400">Path</span>light
        </Link>
        <span className="text-[10px] text-zinc-600 shrink-0">v0.1.0</span>
        <nav className="ml-auto flex items-center gap-1">
          {LINKS.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-2.5 py-1 rounded-md text-sm transition-colors ${
                  active
                    ? "text-zinc-100 bg-zinc-800/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
