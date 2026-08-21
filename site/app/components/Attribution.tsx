"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The scripted run: a pixel becomes a node, a node becomes a component, a
 * component becomes a file:line — advancing on its own, and steerable by hand.
 *
 * Each stage is a real artifact of the run rather than an illustration of one,
 * so the panel that lights up is the panel the CLI would have printed.
 */

const STEPS = [
  { key: "raster", label: "raster", caption: "0.42% of the subject moved" },
  {
    key: "document",
    label: "document",
    caption: "one node differs, and only its paint",
  },
  {
    key: "component",
    label: "component",
    caption: "the node was rendered by Title",
  },
  { key: "file", label: "file", caption: "Title is written here" },
] as const;

function Chevron({ lit }: { lit: boolean }) {
  return (
    <svg
      viewBox="0 0 24 12"
      className={`h-3 w-6 shrink-0 transition-colors duration-500 ${
        lit ? "text-orange" : "text-hairline"
      }`}
      aria-hidden="true"
    >
      <path
        d="M0 6h18M14 2l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Panel({
  title,
  active,
  done,
  children,
}: {
  title: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-xl border transition-all duration-500 ${
        active
          ? "border-orange/60 bg-orange/[0.06] shadow-lg shadow-orange/10"
          : done
            ? "border-hairline bg-panel"
            : "border-hairline bg-panel opacity-45"
      }`}
    >
      <p
        className={`border-b px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors duration-500 ${
          active ? "border-orange/30 text-orange" : "border-hairline text-quiet"
        }`}
      >
        {title}
      </p>
      <div className="flex-1 p-3">{children}</div>
    </div>
  );
}

/** Stage 1 — two captures, one region flagged. */
function RasterPanel({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-2">
      {[false, true].map((isAfter) => (
        <div key={String(isAfter)} className="flex-1">
          <div className="rounded-md border border-hairline bg-deep p-1.5">
            <div className="mb-1 flex gap-0.5">
              <span className="h-1 w-1 rounded-full bg-hairline" />
              <span className="h-1 w-1 rounded-full bg-hairline" />
            </div>
            <div className="space-y-1">
              <div className="h-3 w-full rounded-sm bg-hairline/60" />
              <div className="relative">
                <div
                  className={`h-2.5 rounded-sm transition-all duration-500 ${
                    isAfter && active
                      ? "w-4/5 bg-orange/70"
                      : "w-3/5 bg-hairline/40"
                  }`}
                />
                {isAfter && (
                  <div
                    className={`absolute -inset-1 rounded border border-dashed transition-opacity duration-500 ${
                      active
                        ? "border-orange opacity-100"
                        : "border-transparent opacity-0"
                    }`}
                  />
                )}
              </div>
              <div className="h-1.5 w-2/5 rounded-sm bg-hairline/40" />
            </div>
          </div>
          <p className="mt-1.5 text-center font-mono text-[10px] text-quiet">
            {isAfter ? "current" : "baseline"}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Stage 2 — the document diff, which is what the run actually compares. */
function DocumentPanel({ active }: { active: boolean }) {
  return (
    <pre className="overflow-hidden font-mono text-[11px] leading-[1.6]">
      <code>
        <span className="text-quiet">{'<div class="card">'}</span>
        {"\n"}
        <span
          className={`-mx-1 block rounded px-1 transition-colors duration-500 ${
            active ? "bg-fold/20 text-ivory" : "text-quiet"
          }`}
        >
          <span className="text-fold">- </span>
          {'  <h2 class="title">'}
        </span>
        <span
          className={`-mx-1 block rounded px-1 transition-colors duration-500 ${
            active ? "bg-green/15 text-ivory" : "text-quiet"
          }`}
        >
          <span className="text-green">+ </span>
          {'  <h2 class="title lg">'}
        </span>
        <span className="text-quiet">{"    Modern living"}</span>
        {"\n"}
        <span className="text-quiet">{"  </h2>"}</span>
        {"\n"}
        <span className="text-quiet">{"</div>"}</span>
      </code>
    </pre>
  );
}

/** Stage 3 — the component tree, with the one that owns the node. */
function ComponentPanel({ active }: { active: boolean }) {
  const rows = [
    { name: "Card", depth: 0, hit: false },
    { name: "Header", depth: 1, hit: false },
    { name: "Title", depth: 1, hit: true },
    { name: "Button", depth: 1, hit: false },
  ];
  return (
    <ul className="space-y-1 font-mono text-[11px]">
      {rows.map((r) => (
        <li
          key={r.name}
          style={{ paddingLeft: `${r.depth * 12}px` }}
          className={`flex items-center gap-2 rounded px-1.5 py-1 transition-all duration-500 ${
            r.hit && active ? "bg-orange/15 text-orange" : "text-quiet"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-[2px] transition-colors duration-500 ${
              r.hit && active ? "bg-orange" : "bg-hairline"
            }`}
          />
          {r.name}
          {r.hit && (
            <span
              className={`ml-auto text-[9px] tracking-[0.12em] transition-opacity duration-500 ${
                active ? "opacity-100" : "opacity-0"
              }`}
            >
              TOKEN
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Stage 4 — where it is written. */
function FilePanel({ active }: { active: boolean }) {
  const rows = [
    { name: "src/", dim: true, mark: "" },
    { name: "  components/", dim: true, mark: "" },
    { name: "  Title.tsx", dim: false, mark: "M" },
    { name: "  Button.tsx", dim: true, mark: "" },
  ];
  return (
    <div className="font-mono text-[11px]">
      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.name}
            className={`flex items-center gap-2 whitespace-pre rounded px-1.5 py-1 transition-all duration-500 ${
              !r.dim && active ? "bg-orange/15 text-orange" : "text-quiet"
            }`}
          >
            {r.name}
            {r.mark && <span className="ml-auto text-[9px]">{r.mark}</span>}
          </li>
        ))}
      </ul>
      <p
        className={`mt-2 border-t border-hairline pt-2 transition-colors duration-500 ${
          active ? "text-ivory" : "text-quiet"
        }`}
      >
        <span
          className={
            active
              ? "underline decoration-orange decoration-2 underline-offset-4"
              : ""
          }
        >
          src/components/Title.tsx:14
        </span>
      </p>
    </div>
  );
}

export default function Attribution() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  // Only run while on screen, and never for a reader who asked for stillness.
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      setStep(STEPS.length - 1);
      return;
    }
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2200);
    return () => clearInterval(id);
  }, [running]);

  const panels = [RasterPanel, DocumentPanel, ComponentPanel, FilePanel];

  return (
    <div
      ref={host}
      className="rounded-2xl border border-hairline bg-deep/60 p-5 sm:p-7"
    >
      {/* the chain, as a control strip */}
      <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-3">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.14em] uppercase transition-all duration-300 ${
                i === step
                  ? "border-orange bg-orange text-deep"
                  : i < step
                    ? "border-hairline text-warm hover:border-orange/50"
                    : "border-hairline text-quiet hover:border-orange/50"
              }`}
            >
              {s.label}
            </button>
            {i < STEPS.length - 1 && <Chevron lit={i < step} />}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        {panels.map((P, i) => (
          <Panel
            key={STEPS[i].key}
            title={STEPS[i].label}
            active={i === step}
            done={i < step}
          >
            <P active={i === step} />
          </Panel>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <p className="font-mono text-xs text-quiet">
          <span className="text-orange">{"//"}</span> {STEPS[step].caption}
        </p>
        <p className="font-mono text-[11px] tracking-[0.14em] text-warm uppercase">
          one change · connected end to end
        </p>
      </div>
    </div>
  );
}
