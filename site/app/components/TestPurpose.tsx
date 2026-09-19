/** A high-level test can preserve its promised path while an unasserted detail changes. */
export default function TestPurpose() {
  return (
    <div
      className="relative py-6 sm:py-8"
      role="img"
      aria-label="The asserted path still holds and the test passes, while an unasserted detail branches away from it: a pass can contain a change."
    >
      <p className="!m-0 font-mono text-[10px] tracking-[0.17em] text-muted uppercase">
        a pass can contain a change
      </p>

      <div className="relative mt-5 h-40 sm:h-48" aria-hidden="true">
        <svg
          viewBox="0 0 800 220"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible [mask-image:linear-gradient(to_right,transparent,black_8%,black_90%,transparent)]"
        >
          <g fill="none" stroke="currentColor" className="text-muted">
            <path
              d="M0 58 C180 58 250 48 410 50 S650 56 800 48"
              strokeWidth="1"
              opacity="0.25"
            />
            <path
              d="M0 174 C170 174 250 188 420 186 S650 175 800 178"
              strokeWidth="1"
              opacity="0.25"
            />
            <path d="M0 118 H800" strokeWidth="1.5" opacity="0.65" />
          </g>
          <g fill="currentColor" className="text-muted" opacity="0.45">
            <circle cx="190" cy="54" r="2.5" />
            <circle cx="300" cy="184" r="2.5" />
            <circle cx="695" cy="52" r="2.5" />
          </g>
          <path
            d="M0 118 H440 C540 118 560 63 660 42 S760 25 800 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-orange"
          />
          <circle cx="720" cy="118" r="3" fill="currentColor" className="text-muted" />
        </svg>
        <span className="absolute left-[55%] top-[53.636%] flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-orange/25">
          <span className="h-2 w-2 rounded-full bg-orange" />
        </span>
        <div className="absolute inset-x-0 top-[64%] flex justify-between font-mono text-[9px] tracking-[0.12em] text-muted uppercase sm:text-[10px]">
          <span>asserted path</span>
          <span>path holds</span>
        </div>
        <span className="absolute right-[8%] top-0 font-mono text-[9px] tracking-[0.12em] text-orange uppercase sm:text-[10px]">
          something changed
        </span>
      </div>
    </div>
  );
}
