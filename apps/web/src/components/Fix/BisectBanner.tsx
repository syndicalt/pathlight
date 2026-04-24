"use client";

import Link from "next/link";

interface BisectBannerProps {
  regressionSha: string;
  parentSha?: string;
}

export function BisectBanner({ regressionSha, parentSha }: BisectBannerProps) {
  const short = regressionSha.slice(0, 7);
  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 flex items-start gap-3">
      <svg className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
      <div className="text-sm text-orange-200 space-y-1">
        <p>
          Regression introduced in <code className="bg-orange-500/15 text-orange-100 px-1.5 py-0.5 rounded font-mono text-xs">{short}</code>.
          Fix proposed against that commit.
        </p>
        {parentSha && (
          <p className="text-xs text-orange-300/80">
            Last known good: <code className="font-mono">{parentSha.slice(0, 7)}</code>
          </p>
        )}
        <p className="text-xs">
          <Link href={`/commits?sha=${regressionSha}`} className="underline hover:text-orange-100">
            View traces on this commit
          </Link>
        </p>
      </div>
    </div>
  );
}
