const STEPS = [
  {
    n: "01",
    label: "declare",
    detail: "Button spacing · checkout · at most 12 states",
  },
  {
    n: "02",
    label: "inspect",
    detail: "one repeated change across 11 states",
  },
  {
    n: "03",
    label: "trace",
    detail: "pixels → HTML → Button → src/Button.tsx:42",
  },
  {
    n: "04",
    label: "verify",
    detail: "delivered 11 · undeclared 0 · missing 0",
  },
  {
    n: "05",
    label: "settle",
    detail: "8 safe to accept · 3 stay in review",
  },
] as const;

/** One compact transcript of the evidence loop an agent can complete. */
export default function AgentFlow() {
  return (
    <div className="self-start overflow-hidden rounded-2xl border border-hairline bg-panel">
      <div className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-3">
        <p className="font-mono text-xs text-quiet">agent review</p>
        <p className="font-mono text-[10px] tracking-[0.14em] text-orange uppercase">
          intent first
        </p>
      </div>

      <ol className="divide-y divide-hairline">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="grid gap-2 px-5 py-4 sm:grid-cols-[6.5rem_1fr] sm:items-center"
          >
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-warm uppercase">
              <span className="text-orange">{step.n}</span>
              {step.label}
            </p>
            <p className="text-sm leading-6 text-ivory">{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-hairline bg-deep/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-quiet">
          edit <span className="px-1.5 text-hairline">→</span> rerun{" "}
          <span className="px-1.5 text-hairline">→</span> verified
        </p>
        <p className="font-mono text-xs text-green">same evidence · exit 0</p>
      </div>
    </div>
  );
}
