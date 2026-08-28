/** The evidence beside the claim: one run, one needs-review, one acceptance. */
export default function Verdict() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-[2rem] bg-orange/10 blur-3xl"
      />
      <div className="relative rounded-2xl border border-hairline bg-panel/90 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-fold/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warm/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-green/60" />
          <span className="ml-2 font-mono text-xs text-quiet">
            variance report · 11 affected states
          </span>
        </div>
        {/* Wraps on a phone, where the longest line is half again the width of
            the panel at any legible size. A terminal wraps at column 0 too, so
            this reads as the narrow window it is rather than a cropped image. */}
        <pre className="px-5 py-4 font-mono text-[12px] leading-6 whitespace-pre-wrap sm:overflow-x-auto sm:whitespace-pre">
          <code>
            <span className="text-quiet">$ variance report</span>
            {"\n"}
            <span className="text-ivory">1 repeated cause · 11 states</span>
            {"\n  "}
            <span className="rounded bg-orange/15 px-1 py-0.5 text-orange">
              [needs-review]
            </span>
            <span className="text-ivory"> Button spacing</span>
            {"\n      "}
            {/* Held to the panel's width on purpose. A `pre` scrolls rather
                than wraps, so a longer line reads as a clipped screenshot. */}
            <span className="text-quiet">
              component Button · evidence token, geometry
            </span>
            {"\n      "}
            <span className="text-ivory underline decoration-orange decoration-2 underline-offset-4">
              src/ui/Button.tsx:18
            </span>
            {"\n      "}
            <span className="text-quiet">
              shape v1:9f2a11c4e77b · exact in 8 states
            </span>
            {"\n\n"}
            <span className="text-quiet">
              $ variance accept --shape v1:9f2a11c4e77b
            </span>
            {"\n"}
            <span className="text-green">8 states accepted · one decision</span>
            {"\n"}
            <span className="text-orange">
              3 states add evidence · stay in review
            </span>
            {"\n"}
            <span className="text-quiet">$ </span>
            <span className="caret -mb-0.5 inline-block h-4 w-2 bg-orange align-middle" />
          </code>
        </pre>
      </div>
    </div>
  );
}
