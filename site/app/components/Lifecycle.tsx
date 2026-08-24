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
    cost: "not started",
  },
  {
    key: "collect",
    label: "collect",
    note: "Read markup, applicable CSS, accessibility, and resources without producing a screenshot.",
    subjects: 40,
    rendered: 0,
    cost: "40 documents read",
  },
  {
    key: "settle",
    label: "match",
    note: "Thirty-nine document digests match their baselines, so those UI states stop here.",
    subjects: 40,
    rendered: 0,
    cost: "39 matched · 0 rendered",
  },
  {
    key: "render",
    label: "render",
    note: "The remaining UI state is painted into a screenshot.",
    subjects: 40,
    rendered: 1,
    cost: "1 paint",
  },
  {
    key: "attribute",
    label: "attribute",
    note: "Connect the changed region to its React component and source location.",
    subjects: 40,
    rendered: 1,
    cost: "uses existing evidence",
  },
  {
    key: "verdict",
    label: "verdict",
    note: "Report one item to review, with screenshot evidence, a file:line, and a CI exit code.",
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
      // The timer below keys on `running` alone, so pinning the hop is not
      // enough — without this the run cycles on from the hop it was pinned to.
      setRunning(false);
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
    <div
      ref={host}
      className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7"
    >
      {/* The track. All six hops fit on one line from `lg` up; below that it
          wraps, and a connector belonging to the last hop of a row is left
          pointing at nothing — so the rule carries the sequence only at the
          width where the sequence is actually one line. */}
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:gap-x-0">
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
                className={`mx-3 hidden h-px w-10 transition-colors duration-500 lg:block ${
                  n < i ? "bg-orange/50" : "bg-hairline"
                }`}
              />
            )}
          </li>
        ))}
      </ol>

      {/* Twenty columns keep subjects cell-shaped rather than resembling a
          four-row skeleton loader. */}
      <div className="mt-7 grid grid-cols-10 gap-1.5 sm:grid-cols-20 sm:gap-2">
        {Array.from({ length: 40 }).map((_, n) => {
          // Interior in both layouts: row 3 of 10, row 2 of 20.
          const isResidue = n === 26;
          const isSettled = settled > 0 && !isResidue;
          const isRead = i >= 1;
          return (
            <span
              key={n}
              // Unread subjects are outlined rather than filled: a flat block
              // of forty identical grey bars reads as a skeleton loader, and
              // this is the frame the section opens on.
              className={`h-4 rounded-sm ring-inset transition-all duration-700 sm:h-7 ${
                isResidue && painted
                  ? "bg-orange shadow-[0_0_12px_rgba(255,74,25,0.55)]"
                  : isSettled
                    ? "bg-green/25"
                    : // The one that did not settle is marked a hop before it is
                      // painted — that gap is the point, and without the ring the
                      // residue is indistinguishable until the paint lands.
                      isResidue && settled > 0
                      ? "bg-warm/40 ring-1 ring-orange/60"
                      : isRead
                        ? "bg-warm/40"
                        : "bg-charcoal ring-1 ring-hairline"
              }`}
              style={{ transitionDelay: `${(n % 20) * 14}ms` }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-quiet">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-green/25" /> matched by document{" "}
          {settled}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-orange" /> painted {painted}
        </span>
      </div>

      {/* A two-line floor keeps the panel still as notes wrap. */}
      <div className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4 sm:min-h-12 sm:flex-row sm:items-start sm:justify-between">
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
