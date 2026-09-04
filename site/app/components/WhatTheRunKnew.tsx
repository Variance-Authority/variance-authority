/** The two readings that need no baseline and no second run to be surprising. */
const PROOFS = [
  {
    eyebrow: "attribution",
    title: "The button is gone. The report still names who made it.",
    problem:
      "React removes its pointer from a DOM node the moment that node unmounts, so a click handler that removes the element it fired on has destroyed that element's attribution before the test's next line runs. Not hidden and not expensive—gone, between two adjacent statements.",
    mechanism:
      "A capture-phase listener on the document runs ahead of React's delegated handler and copies the owner chain, the props digest at each boundary, the authoring component and the JSX coordinate in that same synchronous turn. It retains no node and no fiber, which is why it cannot be done a moment later instead.",
    kicker:
      "The element is detached from the document, and the component, its parents, and the file and line that wrote it are all still in the record.",
  },
  {
    eyebrow: "execution",
    title: "Two specs, one service process, one module. They come back apart.",
    problem:
      "A service is the wrong shape to ask about a suite: it outlives every subject in the run, answers several at once, and cannot evaluate a test. A time window is not an execution.",
    mechanism:
      "One opaque id per execution is set on the browser context before the first navigation and rides requests the browser was already sending. The service reports what it entered under that id, to an address it also read off a cookie. Only the driver holds journey → subject, so the service is never told what a spec is.",
    kicker:
      "Counters are keyed by async scope rather than by the process, so two executions interleaving inside one module stay separated. A process-global counter array cannot do that, and neither can a module-global one.",
  },
] as const;

/** The observability shift: a run that leaves a record instead of only a verdict. */
export default function WhatTheRunKnew() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {PROOFS.map((proof) => (
          <article
            key={proof.eyebrow}
            className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7"
          >
            <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
              {proof.eyebrow}
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
              {proof.title}
            </h3>
            <p className="mt-4 text-sm leading-6 text-quiet">{proof.problem}</p>
            <p className="mt-3 text-sm leading-6 text-quiet">
              {proof.mechanism}
            </p>
            <p className="mt-5 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
              {proof.kicker}
            </p>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
        <h3 className="text-xl font-bold tracking-tight text-ivory">
          An absence is never reported as a measurement.
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-quiet">
          Every reading separates <em>nothing was there</em> from{" "}
          <em>nobody looked</em>, and does it in the shape rather than in prose.
          Update initiators the renderer did not expose are unavailable; an
          empty list is a completed reading. A node with no reachable fiber says
          which of the two reasons applies. The case worth reading is the one
          that costs something&mdash;a declared service that reports nothing
          forfeits the whole run&apos;s right to narrow anything:
        </p>
        <pre className="mt-5 overflow-x-auto rounded-xl border border-hairline bg-deep p-4 font-mono text-[11px] leading-5 text-quiet">
          <code>
            heads api reported nothing: a service that was not watched cannot be
            told{"\n"}from one that executed nothing, so no subject in this run
            may justify{"\n"}an exclusion
          </code>
        </pre>
        <p className="mt-5 max-w-3xl text-sm leading-6 text-quiet">
          An instrument that reads silence as zero is confidently wrong in the
          direction that skips a test. This one gives up the narrowing and says
          why.
        </p>
        <a
          href="/docs/observability"
          className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
        >
          ask a question the test did not &rarr;
        </a>
      </div>
    </div>
  );
}
