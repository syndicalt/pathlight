import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceLens",
  description: "Chrome DevTools for AI agents",
};

function Sidebar() {
  return (
    <aside className="fixed top-0 left-0 h-screen w-52 bg-zinc-950 border-r border-zinc-800 flex flex-col z-50">
      <div className="h-14 flex items-center px-5 border-b border-zinc-800">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="text-blue-400">Trace</span>Lens
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        <Link
          href="/"
          className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
          Traces
        </Link>
      </nav>
      <div className="border-t border-zinc-800 px-4 py-3">
        <p className="text-[10px] text-zinc-600">TraceLens v0.1.0</p>
      </div>
    </aside>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 ml-52">{children}</main>
        </div>
      </body>
    </html>
  );
}
