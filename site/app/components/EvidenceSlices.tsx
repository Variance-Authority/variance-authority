const READINGS = [
  {
    key: "a11y",
    label: "accessibility",
    what: "role, accessible name, and ARIA state",
    answer: "what the browser exposed",
  },
  {
    key: "geometry",
    label: "layout",
    what: "structure and computed layout",
    answer: "what moved or reflowed",
  },
  {
    key: "token",
    label: "styles",
    what: "authored values and CSS custom properties",
    answer: "which styling input changed",
  },
  {
    key: "content",
    label: "text",
    what: "visible text and semantic structure",
    answer: "what the interface now says",
  },
  {
    key: "texture",
    label: "pixels",
    what: "remaining painted difference",
    answer: "what only pixels can decide",
  },
] as const;

/** Several independent readings of one captured state, plus one related-state cut. */
export default function EvidenceSlices() {
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
      <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
              one captured state
            </p>
            <p className="mt-1 font-mono text-sm text-ivory">
              story:checkout--dark
            </p>
          </div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-orange uppercase">
            five independent readings
          </p>
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {READINGS.map((reading, index) => (
            <li
              key={reading.key}
              className={`rounded-xl border p-4 ${
                index === READINGS.length - 1
                  ? "border-orange/50 bg-orange/[0.05] sm:col-span-2"
                  : "border-hairline bg-deep"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ivory">
                  {reading.label}
                </p>
                <span className="font-mono text-[10px] text-warm">
                  {reading.key}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-quiet">{reading.what}</p>
              <p className="mt-3 font-mono text-[10px] text-warm">
                {reading.answer}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-5 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
          Each UI state picks the readings that matter to it. Sensitivity is a
          policy per state, not one threshold for the whole suite.
        </p>
      </div>

      <div className="flex flex-col rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
        <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
          another cut through the same run
        </p>
        <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
          Did the variant change, or did both states move together?
        </h3>

        <div className="mt-6 space-y-3">
          <div className="rounded-xl border border-hairline bg-deep p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-quiet">checkout</span>
              <span className="font-mono text-[10px] text-orange">changed</span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-orange/50" />
          </div>
          <div className="rounded-xl border border-hairline bg-deep p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-quiet">checkout--dark</span>
              <span className="font-mono text-[10px] text-orange">changed</span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-orange/50" />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-green/40 bg-green/[0.06] p-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-green uppercase">
            relationship held
          </p>
          <p className="mt-2 text-sm leading-6 text-quiet">
            Both states moved by the same amount. The gap between light and
            dark is unchanged, which is what the dark variant is for.
          </p>
        </div>

        <p className="mt-auto pt-5 text-xs leading-5 text-quiet">
          A tag or naming convention links related states. You define the
          naming in configuration. What the report shows is the relationship
          that changed.
        </p>
      </div>
    </div>
  );
}
