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
    body: "It runs in infrastructure you control, against UI states your Storybook, application, Playwright tests, or browserless unit tests already reach. Captures stay local unless you choose a remote renderer or store.",
    chip: "MIT · your CI, your storage",
  },
  {
    ask: "Visual regression is flaky. Why is this different?",
    verdict: "Changed UI is checked twice, for two different causes.",
    body: "The changed state is captured again in the same page, then alone in a fresh page. The report keeps both readings. If it moves on its own or depends on test order, acceptance is blocked instead of choosing one result as the baseline.",
    chip: "again · alone",
  },
  {
    ask: "What happens when it cannot see something?",
    verdict: "Missing evidence is not a pass.",
    body: "When a capture cannot provide a category of evidence, the report says unobserved. jsdom cannot provide pixels, for example, but it can still compare accessibility, text, and document structure.",
    chip: "unobserved ≠ unchanged",
  },
  {
    ask: "Can I just get a percentage and move on?",
    verdict: "A changed-pixel percentage is evidence, not the verdict.",
    body: "A 1px spacing change can alter thousands of pixels after the page reflows. The report therefore records which document properties, components, and regions changed instead of treating pixel area as importance.",
    chip: "1px → 4949px",
  },
  {
    ask: "How does it plug into CI?",
    verdict: "CI only needs the exit code.",
    body: "0 means nothing to review, 1 means changes need review, and 2 means an operator error. A verdict never shares a code with a crash, and no plugin, webhook, or status API is required.",
    chip: "0 · 1 · 2",
  },
  {
    ask: "So it is free?",
    verdict: "Open source is not the same as zero cost.",
    body: "There is no vendor meter, but you still pay for compute and storage. Unchanged UI states stop after a document comparison, so browser time is reserved for the states that still need it.",
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
