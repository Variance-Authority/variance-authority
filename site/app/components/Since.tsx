"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `sense`, walking the hops a diff opens. The failure this animates is the one
 * every design system already knows: a token file declares no component, so
 * `--since` gives up and the suite runs everything. The answer is two hops away.
 */

/** `edge` is the relation to the row below, so the walk reads straight down. */
const HOPS = [
  {
    name: "src/tokens.css",
    tag: "changed",
    edge: "imported by",
    note: "the diff — and it declares no component, so --since gives up here",
  },
  { name: "src/button.css", tag: "", edge: "imported by", note: "one hop out" },
  { name: "src/Button.tsx", tag: "", edge: "declares", note: "two hops out" },
  {
    name: "Button",
    tag: "component",
    edge: "",
    note: "the component a token file could move",
  },
] as const;

/** 95 ms · 3002 ms · 657 ms · 236 ms — packages/sense bench, 30,500 files, one Mac. */
const SCAN = [
  { label: "git digests", ms: 95, did: "30,501 digests, no file opened" },
  {
    label: "cold",
    ms: 3002,
    did: "every file opened, decoded, parsed, resolved",
  },
  {
    label: "parses remembered",
    ms: 657,
    did: "nothing parsed — every specifier still resolved",
  },
  {
    label: "after a one-file edit",
    ms: 236,
    did: "the diff, and nothing else",
  },
] as const;

export default function Since() {
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(HOPS.length);
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
    const id = setInterval(
      () => setI((n) => (n + 1) % (HOPS.length + 1)),
      1500,
    );
    return () => clearInterval(id);
  }, [running]);

  return (
    <div
      ref={host}
      className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7"
    >
      <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
        what a change could have moved
      </p>

      <ol className="mt-5 space-y-0">
        {HOPS.map((h, n) => {
          const lit = n <= i;
          const isLast = n === HOPS.length - 1;
          return (
            <li key={h.name}>
              <div
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 transition-all duration-500 ${
                  lit
                    ? isLast
                      ? "border-orange/60 bg-orange/[0.08]"
                      : "border-hairline bg-deep"
                    : "border-hairline/50 bg-deep opacity-40"
                }`}
              >
                <span
                  className={`font-mono text-sm transition-colors duration-500 ${
                    lit ? (isLast ? "text-orange" : "text-ivory") : "text-quiet"
                  }`}
                >
                  {h.name}
                </span>
                {h.tag && (
                  <span
                    className={`ml-auto font-mono text-[10px] tracking-[0.14em] uppercase ${
                      isLast ? "text-orange" : "text-warm"
                    }`}
                  >
                    {h.tag}
                  </span>
                )}
              </div>
              {!isLast && (
                <div className="flex items-center gap-2 py-1 pl-5">
                  <span
                    className={`h-5 w-px transition-colors duration-500 ${
                      n < i ? "bg-orange/60" : "bg-hairline"
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] tracking-[0.1em] transition-colors duration-500 ${
                      n < i ? "text-warm" : "text-hairline"
                    }`}
                  >
                    ↓ {h.edge}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 min-h-[2.5rem] font-mono text-xs leading-5 text-quiet">
        <span className="text-orange">{"//"}</span>{" "}
        {i >= HOPS.length
          ? "so the run selects Button's subjects, and skips the rest"
          : HOPS[i].note}
      </p>

      <div className="mt-5 border-t border-hairline pt-4">
        <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
          what a second scan costs
        </p>
        <ul className="mt-3 space-y-1.5">
          {SCAN.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate font-mono text-[11px] text-quiet">
                {s.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-deep">
                <span
                  className={`block h-full rounded-full transition-[width] duration-1000 ease-out ${
                    s.ms === 3002 ? "bg-warm/60" : "bg-orange"
                  }`}
                  style={{ width: `${Math.max(2, (s.ms / 3002) * 100)}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-ivory">
                {s.ms} ms
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-5 text-quiet">
          30,500 files and 40,479 edges, one Mac. A warm scan costs the diff
          rather than the repository.
        </p>
      </div>
    </div>
  );
}
