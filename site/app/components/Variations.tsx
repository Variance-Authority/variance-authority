"use client";

import { useState } from "react";

/**
 * A subject that is another subject on purpose. Each version behind a flag is
 * an ordinary subject with its own baseline, so the difference it exists
 * *for* is the one nothing measures — until the two are linked, either by a
 * tag somebody wrote or by the name the suite already uses.
 */

const PARENT = "story:checkout--default";

const VARIATIONS = [
  {
    id: "story:checkout--dark",
    evidence: "by name",
    how: "no tag — `checkout--dark` extends `checkout--default`’s stem at a separator, so the run reads the link off the name and says that it did.",
    line: "story:checkout--dark ← story:checkout--default (paint)",
    digest: "v1:41c0d7b2a8e5",
    says: "differs in paint alone, led by Checkout — the scheme reached colour and nothing else.",
  },
  {
    id: "story:checkout--new-flow",
    evidence: "tagged",
    how: "tags: ['variance-parent:checkout--default'] — whatever produces the variation stays the collector’s business; the only thing this needs is the link.",
    line: "story:checkout--new-flow ← story:checkout--default (content, structure)",
    digest: "v1:9f2a11c4e77b",
    says: "differs in content and structure, led by Checkout. The digest is taken over the difference, so a token edit that turns the whole suite red leaves it exactly where it was.",
  },
  {
    id: "story:checkout--empty",
    evidence: "tagged",
    how: "the same page with a backend that answers empty. A variation that renders identically to its parent says so — which is a finding when the flag was supposed to change something.",
    line: "story:checkout--empty ← story:checkout--default (identical)",
    digest: "no difference",
    says: "renders identically to its parent this run: the flag reached nothing the run could read.",
  },
] as const;

export default function Variations() {
  const [i, setI] = useState(1);
  const v = VARIATIONS[i];

  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
        one parent, three variations
      </p>

      <p className="mt-4 rounded-lg border border-hairline bg-deep px-3 py-2.5 font-mono text-sm text-ivory">
        {PARENT}
        <span className="ml-3 font-mono text-[10px] tracking-[0.14em] text-warm uppercase">
          parent
        </span>
      </p>

      <ul className="mt-2 space-y-2 pl-5">
        {VARIATIONS.map((x, n) => {
          const on = n === i;
          return (
            <li key={x.id} className="relative">
              {/* the elbow back to the parent, drawn rather than described */}
              <span
                aria-hidden="true"
                className="absolute -left-5 top-0 h-1/2 w-4 rounded-bl-md border-b border-l border-hairline"
              />
              <button
                type="button"
                onClick={() => setI(n)}
                aria-current={on}
                className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 text-left transition-colors duration-300 ${
                  on
                    ? "border-orange/60 bg-orange/[0.08]"
                    : "border-hairline bg-deep hover:border-warm"
                }`}
              >
                <span
                  className={`font-mono text-sm transition-colors duration-300 ${
                    on ? "text-orange" : "text-quiet"
                  }`}
                >
                  {x.id}
                </span>
                <span
                  className={`ml-auto font-mono text-[10px] tracking-[0.14em] uppercase ${
                    x.evidence === "tagged" ? "text-warm" : "text-quiet"
                  }`}
                >
                  {x.evidence}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* keyed so the reading re-enters when another variation is chosen */}
      <div key={i} className="rise mt-5 border-t border-hairline pt-4">
        <p className="font-mono text-xs leading-5 break-all text-ivory">
          {v.line}
        </p>
        <p className="mt-2 text-xs leading-5 text-quiet">{v.says}</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-hairline bg-deep px-3 py-2 font-mono text-[11px] text-orange">
          {v.digest}
        </p>
        <p className="mt-3 font-mono text-[11px] leading-5 text-warm">
          <span className="text-orange">{"//"}</span> {v.how}
        </p>
      </div>

      <p className="mt-5 border-t border-hairline pt-4 text-xs leading-5 text-quiet">
        Nothing on this axis reaches the exit code, acceptance, or the store. A
        dark story is darker than its light parent; reporting that as a
        regression would be reporting a subject for existing.
      </p>
    </div>
  );
}
