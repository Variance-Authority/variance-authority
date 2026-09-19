const STEPS = [
  {
    label: "Inspect",
    detail: "Compare what the test loads and runs with the elements it uses to set up, act, and assert.",
  },
  {
    label: "Try",
    detail: "Pick one dependency worth replacing. Let the agent make one reversible substitution.",
  },
  {
    label: "Check",
    detail: "Rerun the exact test. Compare its assertions, interactions, and component updates before keeping the edit.",
  },
] as const;

/** An illustrative workflow, without presenting invented output as a run. */
export default function AgentFlow() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-panel shadow-2xl shadow-black/20">
      <div className="border-b border-hairline px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
          one thing you can ask your agent
        </p>
        <p className="mt-3 text-xl font-semibold leading-7 tracking-tight text-ivory">
          “Make this checkout test smaller without weakening what it checks.”
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
        href="/docs/distill"
        className="block border-t border-hairline bg-deep/50 px-6 py-4 text-sm text-orange transition-colors hover:text-ivory"
      >
        Follow the test reduction workflow →
      </a>
    </div>
  );
}
