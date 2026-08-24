"use client";

import { useState } from "react";

/**
 * Sensitivity, made pressable. A level is not a threshold: it declares which
 * frequency bands a subject is asserted on at all, so the reader can see a
 * rebrand vanish from a route while a one-pixel nav move survives it.
 */

const BANDS = [
  {
    key: "a11y",
    label: "accessibility",
    what: "role, accessible name, ARIA state",
  },
  { key: "geometry", label: "layout", what: "structure and computed layout" },
  {
    key: "token",
    label: "styles",
    what: "authored values and CSS custom properties",
  },
  { key: "content", label: "text", what: "visible text" },
  { key: "texture", label: "pixels", what: "remaining image differences" },
] as const;

const LEVELS = [
  {
    key: "strict",
    asserts: ["a11y", "geometry", "token", "content", "texture"],
    blurb:
      "Check every category. This is the default for a component's own test.",
    example:
      "a colour token changed, so the component test reports it",
  },
  {
    key: "layout",
    asserts: ["a11y", "geometry"],
    blurb:
      "Check that the route still assembles and remains accessible, without reviewing every repaint.",
    example:
      "a rebrand is excluded; a navigation bar moving 1px is reported",
  },
  {
    key: "content",
    asserts: ["a11y", "content"],
    blurb: "Check the words and accessibility, without comparing their layout.",
    example:
      "a themed embed can change appearance while its copy stays checked",
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
                on
                  ? "border-orange/40 bg-orange/[0.06]"
                  : "border-hairline bg-deep opacity-50"
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
                {b.label}
              </span>
              <span className="text-xs text-quiet">{b.what}</span>
              <span
                className={`ml-auto font-mono text-[10px] tracking-[0.14em] uppercase transition-colors duration-500 ${
                  on ? "text-orange" : "text-warm"
                }`}
              >
                {on ? "checked" : "excluded"}
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
        <span className="text-ivory">Accessibility stays on at every level.</span>{" "}
        Categories are included or excluded as a whole, so a tolerance cannot
        hide a small but real layout change.
      </p>
    </div>
  );
}
