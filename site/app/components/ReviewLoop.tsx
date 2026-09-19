const STAGES = [
  ["reach", "Existing host", "navigation · fixtures · readiness"],
  ["observe", "First reading", "new candidate"],
  ["review", "Person decides", "accept the observed bytes"],
  ["confirm", "Next reading", "unchanged"],
] as const;

/** One state passing through the durable review loop without changing its host. */
export default function ReviewLoop() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <div className="grid gap-3 md:grid-cols-4">
        {STAGES.map(([key, title, detail], index) => (
          <div
            key={key}
            className={`relative rounded-xl border p-5 ${
              index === STAGES.length - 1
                ? "border-green/50 bg-green/[0.05]"
                : index === 2
                  ? "border-orange/50 bg-orange/[0.05]"
                  : "border-hairline bg-deep"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.14em] text-warm uppercase">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={`h-2.5 w-2.5 rotate-45 ${
                  index === 2
                    ? "bg-orange"
                    : index === STAGES.length - 1
                      ? "bg-green"
                      : "bg-warm"
                }`}
                aria-hidden="true"
              />
            </div>
            <p className="mt-6 text-base font-semibold text-ivory">{title}</p>
            <p className="mt-2 font-mono text-[10px] leading-5 text-quiet">
              {detail}
            </p>
            {index < STAGES.length - 1 ? (
              <span className="absolute -right-3 top-1/2 z-10 hidden h-px w-3 bg-orange md:block" aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-5 border-l-2 border-orange pl-4 text-sm leading-6 text-quiet">
        The host keeps responsibility for reaching the state. The observation
        records what was reviewed, and acceptance promotes that exact candidate.
      </p>
    </div>
  );
}
