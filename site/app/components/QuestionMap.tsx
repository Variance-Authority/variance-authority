const QUESTIONS = [
  {
    question: "Why did this UI change?",
    answer:
      "Keep text, accessibility, layout, styles, pixels, React ownership, and source as separate evidence; group repeated effects by cause.",
    href: "#visual-review",
    route: "causal visual review",
  },
  {
    question: "What is happening in this interface?",
    answer:
      "Read presentation relationships, the elements a test addressed, and the component instances that initiated an update.",
    href: "/docs/observability",
    route: "evidence without a baseline",
  },
  {
    question: "Where did two executions part?",
    answer:
      "Compare witnessed scenario steps, component renderings, and the source regions each execution entered at one commit.",
    href: "/docs/scenarios",
    route: "scenarios and journeys",
  },
  {
    question: "What could this edit reach?",
    answer:
      "Join static source relations with recorded execution to select affected UI states and test files, widening when evidence is incomplete.",
    href: "#selection",
    route: "change-driven selection",
  },
  {
    question: "What does this workspace publish?",
    answer:
      "Read TypeScript entrypoints, exported names, signatures, documentation, and consumers directly from source.",
    href: "/agents/workspace-api",
    route: "public API evidence",
  },
  {
    question: "What is a run saying right now?",
    answer:
      "Inspect announcements from the page and its services, including bounded work that opened and never closed, while the suite is still running.",
    href: "/agents/live-run",
    route: "live-run evidence",
  },
] as const;

/** A short route into the evidence family, organized by the reader's question. */
export default function QuestionMap() {
  return (
    <section
      id="questions"
      className="scroll-mt-24 border-t border-hairline py-20"
    >
      <div className="grid gap-x-12 gap-y-5 lg:grid-cols-[1.05fr_1fr] lg:items-start [&>*]:min-w-0">
        <div>
          <p className="mb-4 font-mono text-xs tracking-[0.2em] text-orange uppercase">
            start with the question
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-balance text-ivory sm:text-4xl">
            One evidence family. Several independent answers.
          </h2>
        </div>
        <p className="leading-7 text-quiet lg:pt-8">
          There is no mandatory pipeline. Use the instrument that answers the
          question in front of you; compose readings only when the decision
          needs the chain between them.
        </p>
      </div>

      <div className="mt-10 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-2 lg:grid-cols-3">
        {QUESTIONS.map((item) => (
          <a
            key={item.question}
            href={item.href}
            className="group bg-panel p-6 transition-colors hover:bg-orange/[0.05]"
          >
            <p className="font-mono text-[10px] tracking-[0.14em] text-orange uppercase">
              {item.route}
            </p>
            <h3 className="mt-3 text-lg font-semibold text-ivory">
              {item.question}
            </h3>
            <p className="mt-3 text-sm leading-6 text-quiet">{item.answer}</p>
            <p className="mt-5 font-mono text-xs text-orange transition-colors group-hover:text-ivory">
              follow this question →
            </p>
          </a>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
        A person, a test, or a coding agent can read the same retained evidence.
        The instrument records what it observed and where its knowledge stops;
        the reader decides what to do with it. {" "}
        <a
          href="/docs/information"
          className="text-orange transition-colors hover:text-ivory"
        >
          See how the evidence fits together →
        </a>
      </p>
    </section>
  );
}
