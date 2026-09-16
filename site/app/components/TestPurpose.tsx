const DECISION_HOLDERS = ["product", "engineer", "agent"] as const;

/** A test is worthwhile when its evidence earns the work spent producing it. */
export default function TestPurpose() {
  return (
    <div
      className="rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8 sm:py-10"
      role="img"
      aria-label="Work goes into a test. Evidence comes out and supports a decision for the product, an engineer, or an agent."
    >
      <p className="!m-0 text-center font-mono text-[10px] tracking-[0.17em] text-orange uppercase">
        a test earns its place when
      </p>

      <div className="mx-auto mt-7 grid max-w-4xl items-center gap-0 sm:grid-cols-[1fr_3rem_1fr_4.5rem_1.35fr]">
        <div className="text-center">
          <p className="!m-0 font-mono text-[10px] tracking-[0.15em] text-muted uppercase">work goes in</p>
          <p className="!m-0 pt-2 text-lg font-semibold text-ivory">Write · run · maintain</p>
        </div>

        <div className="mx-auto my-4 h-8 w-px bg-hairline sm:my-0 sm:h-px sm:w-full" aria-hidden="true" />

        <div className="rounded-xl border border-orange px-5 py-5 text-center">
          <p className="!m-0 font-mono text-[10px] tracking-[0.15em] text-orange uppercase">test</p>
          <p className="!m-0 pt-2 text-xl font-bold text-ivory">Ask one question</p>
        </div>

        <div className="relative mx-auto my-4 h-10 w-px bg-orange sm:my-0 sm:h-px sm:w-full" aria-hidden="true">
          <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 bg-panel px-2 font-mono text-[9px] tracking-[0.13em] text-orange uppercase sm:block">
            evidence
          </span>
        </div>

        <div className="text-center">
          <p className="!m-0 font-mono text-[10px] tracking-[0.15em] text-muted uppercase">a decision follows</p>
          <p className="!m-0 pt-2 text-xl font-bold text-ivory">Make one decision</p>
          <p className="!m-0 pt-3 text-xs tracking-wide text-muted">
            {DECISION_HOLDERS.join(" · ")}
          </p>
        </div>
      </div>
    </div>
  );
}
