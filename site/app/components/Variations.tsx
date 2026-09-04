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
    evidence: "name format",
    how: "the configured name format treats `default` as the base and `dark` as another value on the same axis",
    line: "story:checkout--dark ← story:checkout--default (paint)",
    digest: "v1:41c0d7b2a8e5",
    says: "Only colour differs. Checkout is the first affected component.",
  },
  {
    id: "story:checkout--new-flow",
    evidence: "tagged",
    how: "tags: ['variance-parent:checkout--default'] links this variant to the state it varies from",
    line: "story:checkout--new-flow ← story:checkout--default (content, structure)",
    digest: "v1:9f2a11c4e77b",
    says: "Content and structure differ. Checkout is the first affected component. A shared change to both variants leaves this fingerprint unchanged.",
  },
  {
    id: "story:checkout--empty",
    evidence: "tagged",
    how: "the backend returns an empty state, but this capture matches the default state",
    line: "story:checkout--empty ← story:checkout--default (identical)",
    digest: "no difference",
    says: "This variant matches its parent. If it was meant to differ, the flag did not affect anything the run could observe.",
  },
] as const;

export default function Variations() {
  const [i, setI] = useState(0);
  const v = VARIATIONS[i];

  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
        one parent, three related variants
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
        Each variant keeps its own baseline and verdict. The comparison between
        variants does not fail the run by itself; it tells reviewers whether the
        intended difference changed.
      </p>
    </div>
  );
}
