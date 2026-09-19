const STEPS = [
  {
    label: "Record",
    detail: "While the suite runs, keep what it reached: the code each test entered, the interfaces it used, the state it rendered.",
  },
  {
    label: "Retain",
    detail: "Hold that evidence for a repository of hundreds of thousands of files, and keep it between runs.",
  },
  {
    label: "Answer",
    detail: "Put the next question to the record — you or your coding agent — instead of running everything again to find out.",
  },
] as const;

/** The problem underneath the project, without presenting invented output as a run. */
export default function AgentFlow() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-panel shadow-2xl shadow-black/20">
      <div className="border-b border-hairline px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
          the one problem behind all of it
        </p>
        <p className="mt-3 text-xl font-semibold leading-7 tracking-tight text-ivory">
          Every test run knows far more than it reports. When it ends, almost
          all of it is gone.
        </p>
      </div>
      <ol className="divide-y divide-hairline">
        {STEPS.map((step, index) => (
          <li key={step.label} className="grid grid-cols-[1.5rem_1fr] gap-3 px-6 py-4">
            <span className="pt-0.5 font-mono text-xs text-orange">0{index + 1}</span>
            <div>
              <p className="text-sm font-semibold text-ivory">{step.label}</p>
              <p className="mt-1 text-sm leading-6 text-quiet">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <a
        href="/docs/observability"
        className="block border-t border-hairline bg-deep/50 px-6 py-4 text-sm text-orange transition-colors hover:text-ivory"
      >
        See what a run keeps after it ends →
      </a>
    </div>
  );
}
