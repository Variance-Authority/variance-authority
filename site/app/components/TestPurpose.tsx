const STEPS = [
  ["visual regression", "See a correlated effect"],
  ["divergence", "Find the first fork"],
  ["cause + impact", "Follow the evidence"],
  ["decision", "Act within its limit"],
] as const;

/** A visible difference becomes useful when recorded evidence carries it to a decision. */
export default function TestPurpose() {
  return (
    <div
      className="rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8 sm:py-10"
      role="img"
      aria-label="Visual regression sees a correlated effect. Divergence finds the first fork. Recorded evidence connects it to cause, impact, and a bounded decision."
    >
      <p className="!m-0 text-center font-mono text-[10px] tracking-[0.17em] text-orange uppercase">
        follow the difference
      </p>

      <div className="mx-auto mt-7 grid max-w-5xl items-stretch sm:grid-cols-[1fr_2rem_1fr_2rem_1fr_2rem_1fr]">
        {STEPS.map(([label, title], index) => (
          <div className="contents" key={label}>
            <div
              className={`flex min-h-24 flex-col justify-center px-3 text-center ${
                label === "divergence" ? "rounded-xl border border-orange" : ""
              }`}
            >
              <p
                className={`!m-0 font-mono text-[10px] tracking-[0.15em] uppercase ${
                  label === "divergence" ? "text-orange" : "text-muted"
                }`}
              >
                {label}
              </p>
              <p className="!m-0 pt-2 text-base font-semibold text-ivory sm:text-lg">{title}</p>
            </div>

            {index < STEPS.length - 1 ? (
              <div
                className={`mx-auto my-2 h-8 w-px sm:my-auto sm:h-px sm:w-full ${
                  index === 1 ? "bg-orange" : "bg-hairline"
                }`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
