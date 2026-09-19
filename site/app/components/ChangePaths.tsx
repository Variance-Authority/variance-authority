const MIDDLE = [
  {
    label: "stimulus",
    detail: "what entered",
    mark: (
      <path
        d="m23 7-10 16h8l-3 12 11-18h-8l2-10Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    ),
  },
  {
    label: "execution",
    detail: "which path ran",
    mark: (
      <>
        <path
          d="M9 10h8c8 0 5 20 14 20h2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <path
          d="M9 30h8c8 0 5-12 14-12h2"
          fill="none"
          stroke="#756d67"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <circle cx="9" cy="10" r="2.5" fill="#ff4a19" />
        <circle cx="9" cy="30" r="2.5" fill="#756d67" />
        <circle cx="33" cy="30" r="2.5" fill="#ff4a19" />
        <circle cx="33" cy="18" r="2.5" fill="#756d67" />
      </>
    ),
  },
  {
    label: "state",
    detail: "what moved inside",
    mark: (
      <>
        <rect x="8" y="9" width="25" height="7" rx="2" fill="none" stroke="#756d67" strokeWidth="1.5" />
        <rect x="8" y="18" width="25" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="8" y="27" width="25" height="7" rx="2" fill="none" stroke="#756d67" strokeWidth="1.5" />
        <circle cx="28" cy="21.5" r="2.2" fill="#ff4a19" />
      </>
    ),
  },
  {
    label: "effect",
    detail: "what became visible",
    mark: (
      <>
        <circle cx="21" cy="21" r="4" fill="#ff4a19" />
        <circle cx="21" cy="21" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="21" cy="21" r="16" fill="none" stroke="#756d67" strokeWidth="1.5" />
      </>
    ),
  },
] as const;

const READINGS = [
  { label: "source", question: "what could be reached", tone: "quiet" },
  { label: "execution", question: "what was entered", tone: "orange" },
  { label: "state", question: "what moved", tone: "orange" },
  { label: "interface", question: "what became observable", tone: "ivory" },
] as const;

function Arrow({ vertical = false }: { vertical?: boolean }) {
  return (
    <svg
      viewBox={vertical ? "0 0 16 28" : "0 0 28 16"}
      className={
        vertical
          ? "mx-auto h-7 w-4 text-orange"
          : "h-4 w-7 shrink-0 text-orange"
      }
      aria-hidden="true"
    >
      <path
        d={vertical ? "M8 1v24m-4-4 4 4 4-4" : "M1 8h24m-4-4 4 4-4 4"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Endpoint({ label, side }: { label: string; side: "start" | "end" }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-hairline bg-deep p-4 text-center">
      <svg
        viewBox="0 0 42 42"
        className="h-12 w-12 text-warm"
        aria-hidden="true"
      >
        <circle cx="21" cy="21" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="21" cy="21" r="4" fill={side === "start" ? "#756d67" : "#f3f4f6"} />
        {side === "end" ? (
          <circle cx="21" cy="21" r="9" fill="none" stroke="#ff4a19" strokeWidth="2" />
        ) : null}
      </svg>
      <p className="!m-0 pt-3 font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
        {label}
      </p>
    </div>
  );
}

function MiddleCard({ stage }: { stage: (typeof MIDDLE)[number] }) {
  return (
    <div className="rounded-lg border border-hairline bg-deep p-3 text-center">
      <svg
        viewBox="0 0 42 42"
        className="mx-auto h-10 w-10 text-ivory"
        aria-hidden="true"
      >
        {stage.mark}
      </svg>
      <p className="!m-0 pt-2 font-mono text-[10px] tracking-[0.12em] text-ivory uppercase">
        {stage.label}
      </p>
      <p className="!m-0 pt-1 text-[11px] leading-4 text-quiet">
        {stage.detail}
      </p>
    </div>
  );
}

/** The endpoints report a difference; the retained middle explains it. */
export function ChangePath() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-hairline bg-panel p-5 sm:p-7"
      role="img"
      aria-label="A change begins in one condition and ends in another. Between them, retained evidence records the stimulus, execution path, changed state, and observable effect. A test can report that its promised path held while the change reading reports that something else moved."
    >
      <div className="grid items-center gap-3 lg:grid-cols-[0.7fr_auto_3fr_auto_0.7fr]">
        <Endpoint label="beginning" side="start" />
        <div className="hidden lg:block">
          <Arrow />
        </div>
        <div className="rounded-xl border border-orange/50 bg-orange/[0.04] p-4">
          <div className="mb-4 flex items-center justify-between gap-4 border-b border-orange/20 pb-3">
            <p className="!m-0 font-mono text-[10px] tracking-[0.16em] text-orange uppercase">
              the explanatory middle
            </p>
            <p className="!m-0 hidden text-[11px] text-quiet sm:block">
              evidence that disappears when the run ends
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {MIDDLE.map((stage) => (
              <MiddleCard key={stage.label} stage={stage} />
            ))}
          </div>
        </div>
        <div className="hidden lg:block">
          <Arrow />
        </div>
        <Endpoint label="end" side="end" />
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2">
        <div className="flex items-center gap-3 bg-deep px-4 py-3">
          <span className="h-2 w-2 shrink-0 rotate-45 bg-green" />
          <p className="!m-0 font-mono text-[10px] tracking-[0.08em] text-quiet">
            test reading · promised path held
          </p>
        </div>
        <div className="flex items-center gap-3 bg-deep px-4 py-3">
          <span className="h-2 w-2 shrink-0 rotate-45 bg-orange" />
          <p className="!m-0 font-mono text-[10px] tracking-[0.08em] text-quiet">
            change reading · something else moved
          </p>
        </div>
      </div>
    </div>
  );
}

/** Four independent readings connect possible cause to observable result. */
export function EvidencePath() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-hairline bg-panel p-5 sm:p-7"
      role="img"
      aria-label="Source, execution, state, and interface are separate readings along one change. Source says what could be reached, execution says what was entered, state says what moved, and the interface says what became observable."
    >
      <div className="hidden items-center sm:flex">
        {READINGS.map((reading, index) => (
          <div className="contents" key={reading.label}>
            <div
              className={`min-w-0 flex-1 rounded-xl border p-4 text-center ${reading.tone === "orange" ? "border-orange/50 bg-orange/[0.04]" : "border-hairline bg-deep"}`}
            >
              <span
                className={`mx-auto mb-3 block h-2.5 w-2.5 rotate-45 ${reading.tone === "orange" ? "bg-orange" : reading.tone === "ivory" ? "bg-ivory" : "bg-warm"}`}
              />
              <p className="!m-0 font-mono text-[10px] tracking-[0.13em] text-ivory uppercase">
                {reading.label}
              </p>
              <p className="!m-0 pt-2 text-[11px] leading-4 text-quiet">
                {reading.question}
              </p>
            </div>
            {index < READINGS.length - 1 ? <Arrow /> : null}
          </div>
        ))}
      </div>

      <div className="sm:hidden">
        {READINGS.map((reading, index) => (
          <div key={reading.label}>
            <div
              className={`rounded-xl border p-4 text-center ${reading.tone === "orange" ? "border-orange/50 bg-orange/[0.04]" : "border-hairline bg-deep"}`}
            >
              <span
                className={`mx-auto mb-3 block h-2.5 w-2.5 rotate-45 ${reading.tone === "orange" ? "bg-orange" : reading.tone === "ivory" ? "bg-ivory" : "bg-warm"}`}
              />
              <p className="!m-0 font-mono text-[10px] tracking-[0.13em] text-ivory uppercase">
                {reading.label}
              </p>
              <p className="!m-0 pt-2 text-[11px] leading-4 text-quiet">
                {reading.question}
              </p>
            </div>
            {index < READINGS.length - 1 ? <Arrow vertical /> : null}
          </div>
        ))}
      </div>

      <p className="!m-0 pt-5 text-center font-mono text-[10px] tracking-[0.08em] text-quiet">
        Follow the chain forward from an edit, or backward from an effect.
      </p>
    </div>
  );
}
