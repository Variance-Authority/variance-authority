const QUESTIONS = [
  "Which tests matter?",
  "What is still running?",
  "Why did this change?",
  "What evidence is missing?",
] as const;

/** The documentation begins with the decision, then offers independent entrances. */
export default function OverviewQuestions() {
  return (
    <div
      className="rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8"
      role="img"
      aria-label="Start with the decision in front of you: which tests matter, what is still running, why something changed, or what evidence is missing."
    >
      <div className="mx-auto max-w-sm text-center">
        <p className="!m-0 font-mono text-[10px] tracking-[0.17em] text-orange uppercase">start here</p>
        <p className="!m-0 pt-2 text-xl font-bold tracking-tight text-ivory sm:text-2xl">What do you need to decide?</p>
      </div>

      <div className="mx-auto h-9 w-px bg-orange" aria-hidden="true" />

      <div className="relative hidden pt-7 sm:block">
        <div className="absolute inset-x-[12.5%] top-0 h-px bg-hairline" aria-hidden="true" />
        <div className="grid grid-cols-4">
          {QUESTIONS.map((question) => (
            <div key={question} className="relative px-4 text-center">
              <span className="absolute -top-[1.95rem] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-orange" aria-hidden="true" />
              <p className="!m-0 text-sm font-semibold leading-6 text-ivory">{question}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:hidden">
        {QUESTIONS.map((question, index) => (
          <div
            key={question}
            className={`relative flex min-h-24 items-center justify-center px-3 py-5 text-center ${
              index % 2 === 1 ? "border-l border-hairline" : ""
            } ${index > 1 ? "border-t border-hairline" : ""}`}
          >
            <p className="!m-0 text-sm font-semibold leading-5 text-ivory">{question}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
