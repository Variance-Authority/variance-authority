const QUESTIONS = [
  {
    question: "Help my agent work in this codebase.",
    answer: "Discover published APIs, signatures, documentation, and existing usages from the current source. Give your agent relevant names and examples to work with.",
    href: "/agents/workspace-api",
    route: "source intelligence",
    action: "Explore the workspace API",
  },
  {
    question: "Find out why this test is stuck.",
    answer: "Inspect application announcements and unfinished work while the suite runs. Hold a test at an inspection point, investigate with its page still open, then let it continue.",
    href: "/agents/interrogate",
    route: "live investigation",
    action: "Inspect a running test",
  },
  {
    question: "Make this test smaller.",
    answer: "Compare what a test loads and executes with what it interacts with. Try one substitution, rerun the test, and check the behavior it still exercises before keeping the edit.",
    href: "/docs/distill",
    route: "test improvement",
    action: "Find what a test can shed",
  },
  {
    question: "Run the tests this edit needs.",
    answer: "Use recorded execution and source relationships to select affected test files and see why each was selected. Missing evidence expands the run.",
    href: "#selection",
    route: "test selection",
    action: "Focus the next run",
  },
  {
    question: "Understand this interface.",
    answer: "Measure grouping, spacing, alignment, emphasis, and repetition. Highlight the relationships on the live page, make an edit, and measure again.",
    href: "/docs/presentation",
    route: "UI analysis",
    action: "Inspect the rendered layout",
  },
  {
    question: "Explain what changed.",
    answer: "Inspect visual and semantic differences, component attribution, and shared causes. Compare related UI states and find where recorded executions diverge.",
    href: "#visual-review",
    route: "change investigation",
    action: "Follow a UI change",
  },
  {
    question: "Check whether the work did what we intended.",
    answer: "Compare intentions declared before an edit is assessed with its observed effects. Identify what landed, what was not delivered, and what changed outside the declared scope.",
    href: "/docs/reasoning",
    route: "verification and review",
    action: "Follow intent through review",
  },
] as const;

export default function QuestionMap() {
  return (
    <section id="questions" className="scroll-mt-24 border-t border-hairline py-20">
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-orange">
        start with your work
      </p>
      <h2 className="text-3xl font-bold tracking-tight text-ivory sm:text-4xl">
        What are you working on?
      </h2>
      <p className="mt-5 max-w-2xl leading-7 text-quiet">
        Start with the question costing you time. Use the tools that answer it,
        then connect more of them as the investigation grows.
      </p>
      <div className="mt-10 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-2">
        {QUESTIONS.map((item, index) => (
          <a
            key={item.question}
            href={item.href}
            className={`group flex flex-col bg-panel p-6 transition-colors hover:bg-deep sm:p-8 ${index === QUESTIONS.length - 1 ? "md:col-span-2" : ""}`}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
              {item.route}
            </p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-ivory">{item.question}</h3>
            <p className="mt-3 mb-6 max-w-3xl text-sm leading-6 text-quiet">{item.answer}</p>
            <p className="mt-auto text-sm text-orange transition-colors group-hover:text-ivory">
              {item.action} →
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}
