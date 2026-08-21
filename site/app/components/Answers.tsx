"use client";

import { useRef, useState } from "react";

/**
 * The six doubts anyone who has run visual regression at scale arrives with,
 * and what this project answers to each. Written as objections rather than
 * features because the reader is already sceptical, and a list of six equal
 * assurances is what they have learned to skim.
 */

const ANSWERS = [
  {
    ask: "Is this another dashboard I have to pay for?",
    verdict: "No vendor account. No hosted dashboard.",
    body: "It runs in infrastructure you control, against UI states your Storybook, application, Playwright tests, or browserless unit tests already reach. Capture material stays local, or travels only to a renderer and store you chose.",
    chip: "MIT · your CI, your storage",
  },
  {
    ask: "Visual regression is flaky. Why is this different?",
    verdict: "Retries are not an answer.",
    body: "Anyone who says otherwise has either not run it at scale or has quietly set a threshold large enough to hide it. A changed subject is read again — same world, time advanced — and alone, with the world rebuilt. Both outcomes are reported, nothing is cleared, and acceptance refuses to promote a reading that a race chose.",
    chip: "again · alone",
  },
  {
    ask: "What happens when it cannot see something?",
    verdict: "Missing evidence is not a pass.",
    body: "A profile that cannot observe a band says so: the report reads unobserved, and never converts what it failed to see into a green check. Under jsdom that is honest about pixels — and still decisive about the two bands a document fully answers, because a role, an accessible name and a text node are facts about a document rather than a picture.",
    chip: "unobserved ≠ unchanged",
  },
  {
    ask: "Can I just get a percentage and move on?",
    verdict: "No pixels are ever stored.",
    body: "Not squeamishness about size — a measurement. A 1px edit to a spacing token produces 4949 changed pixels, because the count is dominated by how much page sits below the edit. This project built the pixel-count ledger, then killed it with its own number. What accumulates instead is the record, so a button that gained 2px eleven times reports the 22px nobody ever saw.",
    chip: "1px → 4949px",
  },
  {
    ask: "How does it plug into CI?",
    verdict: "The exit code is the whole interface.",
    body: "0: nothing to review. 1: changes to review. 2: operator error. A verdict and a crash never share a code, so any CI that can run a command already has the gate — no plugin, no webhook, no status API to keep alive.",
    chip: "0 · 1 · 2",
  },
  {
    ask: "So it is free?",
    verdict: "“No per-shot bill” is not the same claim as “free.”",
    body: "There is no vendor meter. You pay in compute and storage you already own — and the run is engineered so that a subject which did not change costs a hash comparison rather than a render. A green run pays almost nothing, which is the only reason the budget survives the subjects that did move.",
    chip: "no meter · real compute",
  },
] as const;

export default function Answers() {
  const [i, setI] = useState(0);
  const a = ANSWERS[i];
  const ruling = useRef<HTMLDivElement>(null);

  /**
   * One column below `lg`, where the ruling is a screenful past the list and
   * answering a doubt would otherwise look like nothing happened. Side by side
   * the ruling is already in view — and taller than the viewport, so `nearest`
   * would chase its own sticky offset.
   */
  function choose(n: number) {
    setI(n);
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      ruling.current?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[5fr_6fr] [&>*]:min-w-0">
      {/* the doubts */}
      <div>
        <p className="mb-3 pl-4 font-mono text-[11px] tracking-[0.18em] text-quiet uppercase">
          the doubt
        </p>
        <ul className="flex flex-col">
          {ANSWERS.map((x, n) => {
            const on = n === i;
            return (
              <li key={x.ask}>
                <button
                  type="button"
                  onClick={() => choose(n)}
                  aria-current={on}
                  className={`group flex w-full items-start gap-3 border-l-2 py-3 pr-3 pl-4 text-left transition-all duration-300 ${
                    on
                      ? "border-orange bg-orange/[0.06]"
                      : "border-hairline hover:border-warm hover:bg-panel/60"
                  }`}
                >
                  <span
                    className={`mt-0.5 font-mono text-[11px] transition-colors duration-300 ${
                      on ? "text-orange" : "text-warm group-hover:text-quiet"
                    }`}
                  >
                    {String(n + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`text-sm leading-6 transition-colors duration-300 ${
                      on
                        ? "font-medium text-ivory"
                        : "text-quiet group-hover:text-warm"
                    }`}
                  >
                    {x.ask}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* the ruling — keyed so it re-enters whenever the doubt changes */}
      <div
        ref={ruling}
        className="relative scroll-mt-6 rounded-2xl border border-hairline bg-panel p-6 sm:p-8 lg:sticky lg:top-10 lg:self-start"
      >
        <div
          aria-hidden="true"
          className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-orange/[0.07] blur-3xl"
        />
        <div key={i} className="rise relative">
          <p className="font-mono text-[11px] tracking-[0.18em] text-quiet uppercase">
            the answer
          </p>
          <p className="mt-3 text-xl leading-8 font-bold tracking-tight text-ivory sm:text-2xl">
            {a.verdict}
          </p>
          <p className="mt-4 text-sm leading-7 text-quiet">{a.body}</p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-lg border border-hairline bg-deep px-3 py-2 font-mono text-xs text-orange">
            {a.chip}
          </p>
        </div>
      </div>
    </div>
  );
}
