import type { Metadata } from "next";
import "./globals.css";
import { BreakpointsPanel } from "../components/BreakpointsPanel";
import { TopNav } from "../components/TopNav";

export const metadata: Metadata = {
  title: "Pathlight",
  description: "Visual debugging and observability for AI agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <TopNav />
        <main>{children}</main>
        <BreakpointsPanel />
      </body>
    </html>
  );
}
