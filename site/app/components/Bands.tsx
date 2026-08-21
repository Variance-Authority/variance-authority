"use client";

import { useState } from "react";

/**
 * Sensitivity, made pressable. A level is not a threshold: it declares which
 * frequency bands a subject is asserted on at all, so the reader can see a
 * rebrand vanish from a route while a one-pixel nav move survives it.
 */

const BANDS = [
  { key: "a11y", what: "role, accessible name, ARIA state" },
  { key: "geometry", what: "structure, rects and computed layout" },
  { key: "token", what: "declared values and custom properties" },
  { key: "content", what: "text" },
  { key: "texture", what: "raster residue — pixels and nothing else" },
] as const;

const LEVELS = [
  {
    key: "strict",
    asserts: ["a11y", "geometry", "token", "content", "texture"],
    blurb:
      "Everything. The default, and how an exception is written back inside a relaxed group.",
    example: "a component's own test: a colour token moved and that is the change",
  },
  {
    key: "layout",
    asserts: ["a11y", "geometry"],
    blurb: "A route asserts that the page still assembles, not what it was painted.",
    example: "a rebrand repaints forty routes and reports nothing; a nav that moved 1px reports",
  },
  {
    key: "content",
    asserts: ["a11y", "content"],
    blurb: "The words are the subject; where they landed is not.",
    example: "a themed embed you do not control, whose copy still has to be right",
  },
] as const;

export default function Bands() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]["key"]>("layout");
  const active = LEVELS.find((l) => l.key === level)!;

  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[11px] tracking-[0.14em] text-quiet uppercase">
          level
        </span>
        {LEVELS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLevel(l.key)}
            className={`rounded-full border px-3 py-1 font-mono text-xs transition-all duration-300 ${
              l.key === level
                ? "border-orange bg-orange text-deep"
                : "border-hairline text-quiet hover:border-orange/50 hover:text-ivory"
            }`}
          >
            {l.key}
          </button>
        ))}
      </div>

      <ul className="mt-6 space-y-2">
        {BANDS.map((b) => {
          const on = (active.asserts as readonly string[]).includes(b.key);
          return (
            <li
              key={b.key}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 transition-all duration-500 ${
                on ? "border-orange/40 bg-orange/[0.06]" : "border-hairline bg-deep opacity-50"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-sm transition-colors duration-500 ${
                  on ? "bg-orange" : "bg-hairline"
                }`}
              />
              <span
                className={`font-mono text-sm transition-colors duration-500 ${
                  on ? "text-ivory" : "text-quiet"
                }`}
              >
                {b.key}
              </span>
              <span className="text-xs text-quiet">{b.what}</span>
              <span
                className={`ml-auto font-mono text-[10px] tracking-[0.14em] uppercase transition-colors duration-500 ${
                  on ? "text-orange" : "text-warm"
                }`}
              >
                {on ? "asserted" : "absorbed"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 border-t border-hairline pt-4">
        <p className="text-sm leading-6 text-quiet">{active.blurb}</p>
        <p className="mt-2 font-mono text-xs text-warm">
          <span className="text-orange">{"//"}</span> {active.example}
        </p>
      </div>
      <p className="mt-4 text-xs leading-5 text-quiet">
        <span className="text-ivory">a11y is in every level deliberately.</span> A band
        absorbs exactly one kind of thing however large it is; a threshold absorbs
        anything small enough, including a small real change.
      </p>
    </div>
  );
}
