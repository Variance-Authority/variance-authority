const STEPS = [
  ["question", "Name the decision"],
  ["observe", "Read the evidence"],
  ["relate", "Connect what agrees"],
  ["decide", "Make one supported move"],
] as const;

function StepMark({ index }: { index: number }) {
  if (index === 0) {
    return (
      <>
        <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M14.5 15.5a5.8 5.8 0 0 1 11 2.5c0 4-5.5 4.1-5.5 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="20" cy="30" r="1.5" fill="#ff4a19" />
      </>
    );
  }
  if (index === 1) {
    return (
      <>
        <path d="M5 21s6-9 15-9 15 9 15 9-6 9-15 9S5 21 5 21Z" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="20" cy="21" r="4" fill="#ff4a19" />
      </>
    );
  }
  if (index === 2) {
    return (
      <>
        <circle cx="8" cy="11" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="31" cy="10" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="20" cy="31" r="5" fill="#ff4a19" />
        <path d="m11 14 6 12m11-12-6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  return (
    <>
      <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m12 20 5 5 11-12" fill="none" stroke="#7fa28c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** The reasoning loop, including the productive result where evidence stops. */
export default function ReasoningLoop() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <div className="grid gap-3 md:grid-cols-4">
        {STEPS.map(([label, body], index) => (
          <div key={label} className="relative flex items-center gap-4 rounded-xl border border-hairline bg-deep p-4 md:block md:text-center">
            <svg viewBox="0 0 40 40" className="h-12 w-12 shrink-0 text-ivory md:mx-auto" aria-hidden="true">
              <StepMark index={index} />
            </svg>
            <div>
              <p className="font-mono text-[9px] tracking-[0.15em] text-orange uppercase">
                {label}
              </p>
              <p className="mt-1 text-sm leading-5 text-ivory">{body}</p>
            </div>
            {index < STEPS.length - 1 ? (
              <span className="absolute -right-3 top-1/2 z-10 hidden h-px w-3 bg-orange md:block" aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2">
        <div className="bg-deep p-5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-green uppercase">
            enough evidence
          </p>
          <p className="mt-2 text-sm leading-6 text-quiet">
            Act within the boundary the observation established.
          </p>
        </div>
        <div className="bg-deep p-5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-orange uppercase">
            evidence stops
          </p>
          <p className="mt-2 text-sm leading-6 text-quiet">
            Name what is missing. That missing observation becomes the next
            question.
          </p>
        </div>
      </div>
    </div>
  );
}
