const EVIDENCE = ["source", "execution", "interface", "history"] as const;

function Arrow() {
  return (
    <div className="flex h-10 items-center justify-center md:h-auto md:w-12" aria-hidden="true">
      <svg viewBox="0 0 48 40" className="hidden h-10 w-12 md:block">
        <path d="M3 20h36m-8-7 8 7-8 7" fill="none" stroke="#ff4a19" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 40 40" className="h-10 w-10 md:hidden">
        <path d="M20 3v28m-7-8 7 8 7-8" fill="none" stroke="#ff4a19" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** A question chooses evidence; the evidence bounds the move that follows. */
export default function EvidenceMap() {
  return (
    <div
      className="rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8"
      role="img"
      aria-label="One question chooses source, execution, interface, or history evidence. That evidence supports one move and makes its limit visible."
    >
      <div className="grid items-center justify-center md:grid-cols-[12rem_auto_minmax(16rem,1fr)_auto_12rem] md:gap-4">
        <section className="mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-full border-2 border-orange bg-deep text-center">
          <p className="!m-0 font-mono text-[10px] tracking-[0.16em] text-orange uppercase">question</p>
          <p className="!m-0 max-w-[7rem] pt-2 text-base font-semibold leading-6 text-ivory">one decision to make</p>
        </section>

        <Arrow />

        <section className="text-center">
          <p className="!m-0 font-mono text-[10px] tracking-[0.16em] text-warm uppercase">evidence</p>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
            {EVIDENCE.map((label) => (
              <div key={label} className="flex items-center gap-2 border-b border-hairline pb-2 text-left">
                <span className="h-2 w-2 shrink-0 rounded-full bg-warm" aria-hidden="true" />
                <span className="text-sm font-semibold text-ivory">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <Arrow />

        <section className="mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-xl border border-green/70 bg-green/[0.04] text-center">
          <p className="!m-0 font-mono text-[10px] tracking-[0.16em] text-green uppercase">supported move</p>
          <p className="!m-0 max-w-[7rem] pt-2 text-base font-semibold leading-6 text-ivory">with a visible limit</p>
        </section>
      </div>
    </div>
  );
}
