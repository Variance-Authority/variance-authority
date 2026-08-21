"use client";

import { useEffect, useRef, useState } from "react";

/**
 * What a run does to forty subjects, in order and with the cost of each hop.
 * The point the animation carries: almost everything is settled before a
 * browser paints anything, so the expensive stage only ever sees the residue.
 */

const HOPS = [
  {
    key: "commit",
    label: "commit",
    note: "A pull request touches one spacing token.",
    subjects: 40,
    rendered: 0,
    cost: "—",
  },
  {
    key: "collect",
    label: "collect",
    note: "Each subject is read once: markup, applicable CSS, semantics, resources. Never a paint.",
    subjects: 40,
    rendered: 0,
    cost: "40 collections",
  },
  {
    key: "settle",
    label: "settle",
    note: "A subject whose document digest equals its baseline's is finished here — 32 hex characters rather than an image.",
    subjects: 40,
    rendered: 0,
    cost: "39 settled · 0 rendered",
  },
  {
    key: "render",
    label: "render",
    note: "Only the residue is painted. One subject reaches a browser.",
    subjects: 40,
    rendered: 1,
    cost: "1 paint",
  },
  {
    key: "attribute",
    label: "attribute",
    note: "A fold over digests the run already produced: the changed region, the component that owns it, the line that wrote it.",
    subjects: 40,
    rendered: 1,
    cost: "no new work",
  },
  {
    key: "verdict",
    label: "verdict",
    note: "One root to review, with a file:line — and an exit code CI already understands.",
    subjects: 40,
    rendered: 1,
    cost: "exit 1",
  },
] as const;

export default function Lifecycle() {
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(HOPS.length - 1);
      return;
    }
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setI((n) => (n + 1) % HOPS.length), 2400);
    return () => clearInterval(id);
  }, [running]);

  const hop = HOPS[i];
  const settled = i >= 2 ? 39 : 0;
  const painted = hop.rendered;

  return (
    <div ref={host} className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      {/* the track */}
      <ol className="flex flex-wrap items-center gap-y-3">
        {HOPS.map((h, n) => (
          <li key={h.key} className="flex items-center">
            <button
              type="button"
              onClick={() => setI(n)}
              className="group flex items-center gap-2"
              aria-current={n === i}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] transition-all duration-500 ${
                  n === i
                    ? "border-orange bg-orange text-deep"
                    : n < i
                      ? "border-orange/40 bg-orange/10 text-orange"
                      : "border-hairline bg-deep text-quiet"
                }`}
              >
                {n + 1}
              </span>
              <span
                className={`font-mono text-[11px] tracking-[0.12em] uppercase transition-colors duration-500 ${
                  n === i ? "text-ivory" : "text-quiet group-hover:text-warm"
                }`}
              >
                {h.label}
              </span>
            </button>
            {n < HOPS.length - 1 && (
              <span
                className={`mx-3 h-px w-6 transition-colors duration-500 sm:w-10 ${
                  n < i ? "bg-orange/50" : "bg-hairline"
                }`}
              />
            )}
          </li>
        ))}
      </ol>

      {/* the forty subjects, thinning out */}
      <div className="mt-7 grid grid-cols-10 gap-1.5 sm:gap-2">
        {Array.from({ length: 40 }).map((_, n) => {
          const isResidue = n === 17;
          const isSettled = settled > 0 && !isResidue;
          const isRead = i >= 1;
          return (
            <span
              key={n}
              className={`h-4 rounded-sm transition-all duration-700 ${
                isResidue && painted
                  ? "bg-orange shadow-[0_0_12px_rgba(255,74,25,0.55)]"
                  : isSettled
                    ? "bg-green/25"
                    : isRead
                      ? "bg-warm/40"
                      : "bg-hairline/50"
              }`}
              style={{ transitionDelay: `${(n % 10) * 18}ms` }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-quiet">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-green/25" /> settled by digest {settled || "—"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-orange" /> painted {painted || "—"}
        </span>
      </div>

      {/* what this hop costs */}
      <div className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-xl text-sm leading-6 text-quiet">
          <span className="font-mono text-xs tracking-[0.12em] text-orange uppercase">
            {hop.label}
          </span>
          <span className="mx-2 text-hairline">·</span>
          {hop.note}
        </p>
        <p className="shrink-0 font-mono text-xs text-warm">{hop.cost}</p>
      </div>
    </div>
  );
}
