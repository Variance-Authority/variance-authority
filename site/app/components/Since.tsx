"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Static reach connects a changed source file to a component, then the capture
 * inventory names the UI states that rendered that component.
 */

/** `edge` is the relation to the row below, so the walk reads straight down. */
const HOPS = [
  {
    name: "src/tokens.css",
    tag: "changed",
    edge: "imported by",
    note: "this file changed, and it declares no component",
  },
  {
    name: "src/button.css",
    tag: "",
    edge: "imported by",
    note: "a scan of JS imports alone stops here",
  },
  {
    name: "src/Button.tsx",
    tag: "",
    edge: "declares",
    note: "the first hop that declares a component a baseline can record",
  },
  {
    name: "Button",
    tag: "component",
    edge: "",
    note: "the walk ends here, and the baselines decide which states are read",
  },
] as const;

export default function Since() {
  const [i, setI] = useState(0);
  const [running, setRunning] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setI(HOPS.length);
      // The timer below keys on `running` alone, so pinning the hop is not
      // enough — without this the walk cycles on from the hop it was pinned to.
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
        how tokens.css reaches Button
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
          ? "a subject whose baseline lists no Button is skipped. A subject with no baseline is always run."
          : HOPS[i].note}
      </p>

      <div className="mt-5 border-t border-hairline pt-4">
        <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
          selected UI states
        </p>
        <ul className="mt-3 space-y-2 font-mono text-[11px]">
          <li className="flex items-center justify-between gap-3 rounded border border-orange/40 bg-orange/[0.06] px-3 py-2">
            <span className="text-ivory">story:button--primary</span>
            <span className="text-orange">rendered Button</span>
          </li>
          <li className="flex items-center justify-between gap-3 rounded border border-orange/40 bg-orange/[0.06] px-3 py-2">
            <span className="text-ivory">route:/checkout</span>
            <span className="text-orange">rendered Button</span>
          </li>
          <li className="flex items-center justify-between gap-3 rounded border border-hairline bg-deep px-3 py-2">
            <span className="text-quiet">story:empty-cart</span>
            <span className="text-warm">baseline records no Button</span>
          </li>
        </ul>
        <p className="mt-3 text-xs leading-5 text-quiet">
          The graph tells the run which components a change reached. The
          baseline decides what to skip: a subject drops out only when its own
          baseline lists none of those components. The graph alone never drops a
          subject. Uncertainty always widens the run—a missing baseline, a
          missing component list, or an unreadable import each adds work. A warm
          rescan of a generated 30,500-file tree takes about 236 ms, and a
          one-file edit costs no measurable extra time.
        </p>
      </div>
    </div>
  );
}
