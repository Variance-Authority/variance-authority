const CHECKPOINTS = ["start", "action", "outcome"] as const;

function Path({ changed = false }: { changed?: boolean }) {
  return (
    <div className="relative h-14 min-w-0" aria-hidden="true">
      <div className="absolute inset-x-2 top-3 h-px bg-hairline" />
      {CHECKPOINTS.map((checkpoint, index) => (
        <span
          className="absolute top-[0.45rem] h-3 w-3 -translate-x-1/2 rounded-full border border-muted bg-panel"
          key={checkpoint}
          style={{ left: `${8 + index * 42}%` }}
        />
      ))}
      {changed ? (
        <>
          <span className="absolute left-[66%] top-3 h-5 w-px bg-orange" />
          <span className="absolute left-[66%] top-7 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-orange" />
          <span className="absolute left-[66%] top-10 -translate-x-1/2 whitespace-nowrap font-mono text-[8px] tracking-[0.12em] text-orange uppercase">
            something changed
          </span>
        </>
      ) : null}
    </div>
  );
}

/** A high-level test can preserve its promised path while an unasserted detail changes. */
export default function TestPurpose() {
  return (
    <div
      className="rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8 sm:py-10"
      role="img"
      aria-label="The codified path and the current run reach the same expected outcome, so the test passes, while an unasserted detail in the current run has changed."
    >
      <p className="!m-0 text-center font-mono text-[10px] tracking-[0.17em] text-orange uppercase">
        a pass can contain a change
      </p>

      <div className="mx-auto mt-7 grid max-w-4xl grid-cols-[5.5rem_minmax(0,1fr)_4.25rem] items-center gap-x-3 gap-y-5 sm:grid-cols-[8rem_minmax(0,1fr)_6rem] sm:gap-x-6">
        <p className="!m-0 font-mono text-[9px] tracking-[0.13em] text-muted uppercase sm:text-[10px]">
          codified path
        </p>
        <Path />
        <p className="!m-0 text-right font-mono text-[9px] tracking-[0.13em] text-muted uppercase sm:text-[10px]">
          expected
        </p>

        <p className="!m-0 font-mono text-[9px] tracking-[0.13em] text-muted uppercase sm:text-[10px]">
          current run
        </p>
        <Path changed />
        <p className="!m-0 text-right font-mono text-[10px] tracking-[0.13em] text-green uppercase">
          path holds
        </p>
      </div>
    </div>
  );
}
