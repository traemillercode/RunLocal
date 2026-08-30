/**
 * The build id, visible on every page.
 *
 * Asked for three times, and three separate bug reports could not be
 * reproduced without it — the reporter and the tester were looking at
 * different code and had no way to tell. A tester reads this line back and the
 * question is settled in one message instead of three.
 *
 * Deliberately quiet: 11px, muted, no label beyond "build". It is diagnostic
 * furniture, not information anyone needs while using the product.
 */
export function BuildStamp({ className = "" }: { className?: string }) {
  const build = String((import.meta.env as Record<string, unknown>).VITE_BUILD_ID ?? "dev");
  return (
    <p className={`text-[11px] text-slate-400 ${className}`}>
      build <span className="font-mono">{build.slice(0, 7)}</span>
    </p>
  );
}
