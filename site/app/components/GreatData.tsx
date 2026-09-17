const EVIDENCE = [
  "identity",
  "source",
  "execution",
  "semantics",
  "pixels",
  "history",
] as const;

const CONSUMERS = [
  {
    key: "tests",
    eyebrow: "test selection",
    title: "Run what matters",
    detail: "A selected run renews the record that selected it",
  },
  {
    key: "visual",
    eyebrow: "visual review",
    title: "Compare and explain",
    detail: "Relate a change to its cause",
  },
  {
    key: "tools",
    eyebrow: "other tools",
    title: "Locate and understand",
    detail: "Answer questions beyond a test",
  },
] as const;

function ConsumerMark({ kind }: { kind: (typeof CONSUMERS)[number]["key"] }) {
  if (kind === "tests") {
    return (
      <>
        <path d="m10 21 7 7 15-17" fill="none" stroke="#7fa28c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 7h28v28H7z" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    );
  }
  if (kind === "visual") {
    return (
      <>
        <path d="M4 21s7-11 17-11 17 11 17 11-7 11-17 11S4 21 4 21Z" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="21" cy="21" r="6" fill="#ff4a19" />
      </>
    );
  }
  return (
    <>
      <circle cx="9" cy="21" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="21" cy="9" r="4" fill="#ff4a19" />
      <circle cx="33" cy="21" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="21" cy="33" r="4" fill="#7fa28c" />
      <path d="m12 18 6-6m6 0 6 6m0 6-6 6m-6 0-6-6" fill="none" stroke="#756d67" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

function BranchConnector({ reciprocal }: { reciprocal?: boolean }) {
  return (
    <svg
      viewBox="0 0 14 30"
      className={`absolute left-1/2 top-0 h-7 w-4 -translate-x-1/2 -translate-y-full text-orange ${
        reciprocal ? "block" : "hidden md:block"
      }`}
      aria-hidden="true"
    >
      <path d="M7 2v26" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {reciprocal ? (
        <path d="m3 6 4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      <path d="m3 24 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownArrow() {
  return (
    <svg viewBox="0 0 12 20" className="mx-auto my-2 h-5 w-3 text-warm" aria-hidden="true">
      <path d="M6 1v17m-4-4 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TestReduction() {
  return (
    <div className="mt-3">
      <DownArrow />
      <p className="!m-0 font-mono text-[9px] tracking-[0.12em] text-warm uppercase">
        distil one test
      </p>
      <DownArrow />
      <p className="!m-0 font-mono text-[9px] tracking-[0.12em] text-green uppercase">
        own fewer tests
      </p>
    </div>
  );
}

/** One evidence field supports tests, visual review, and tools with other jobs. */
export default function GreatData() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8"
      role="img"
      aria-label="Identity, source, execution, semantics, pixels, and history form one shared evidence field. Tests use it to select and diagnose. Visual review uses it to compare and explain. Other tools use it to locate and understand. Each consumer chooses the evidence its question needs."
    >
      <section className="mx-auto max-w-3xl rounded-xl border border-orange/60 bg-orange/[0.04] px-5 py-6 text-center">
        <p className="!m-0 font-mono text-[10px] tracking-[0.18em] text-orange uppercase">
          shared evidence
        </p>
        <p className="!m-0 pt-2 text-xl font-bold tracking-tight text-ivory sm:text-2xl">
          Know what happened
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {EVIDENCE.map((item) => (
            <span
              key={item}
              className="rounded-full border border-hairline bg-deep px-3 py-1 font-mono text-[10px] tracking-[0.08em] text-warm"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <div className="mx-auto h-8 w-px bg-orange" aria-hidden="true" />
      <div className="relative mx-auto hidden h-px max-w-[67%] bg-orange md:block" aria-hidden="true">
        <span className="absolute -top-1 left-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-orange" />
        <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-orange" />
        <span className="absolute -top-1 right-0 h-2 w-2 translate-x-1/2 rotate-45 bg-orange" />
      </div>

      <div className="grid gap-3 md:grid-cols-3 md:gap-5">
        {CONSUMERS.map((consumer) => (
          <section
            key={consumer.key}
            className="relative rounded-xl border border-hairline bg-deep p-5 text-center md:pt-7"
          >
            <BranchConnector reciprocal={consumer.key === "tests"} />
            <svg viewBox="0 0 42 42" className="mx-auto h-12 w-12 text-ivory" aria-hidden="true">
              <ConsumerMark kind={consumer.key} />
            </svg>
            <p className="!m-0 pt-3 font-mono text-[9px] tracking-[0.16em] text-orange uppercase">
              {consumer.eyebrow}
            </p>
            <h3 className="!m-0 pt-2 text-base font-bold tracking-tight text-ivory">
              {consumer.title}
            </h3>
            <p className="!m-0 pt-2 text-xs leading-5 text-quiet sm:text-sm">
              {consumer.detail}
            </p>
            {consumer.key === "tests" ? <TestReduction /> : null}
          </section>
        ))}
      </div>

      <p className="!m-0 pt-6 text-center font-mono text-[10px] tracking-[0.1em] text-quiet">
        Selection feeds the record back. Each other question takes the evidence
        it needs.
      </p>
    </div>
  );
}
