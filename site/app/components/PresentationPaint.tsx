const RECORDS = [
  { y: 92, index: 1 },
  { y: 168, index: 2 },
  { y: 244, index: 3 },
] as const;

/**
 * A focused report rendered as the overlay the page agent adds to a live
 * subject. The marks name measurements; they deliberately do not suggest a
 * product-side correction.
 */
export default function PresentationPaint() {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-3 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline px-1 pb-3 font-mono text-[10px] tracking-[0.12em] uppercase">
        <span className="text-warm">captured application · Demands</span>
        <span className="text-orange">paint: repetition, findings</span>
      </div>

      <svg
        viewBox="0 0 680 372"
        className="block h-auto w-full"
        role="img"
        aria-labelledby="presentation-paint-title presentation-paint-description"
      >
        <title id="presentation-paint-title">
          A focused presentation report with repetition and finding paint
        </title>
        <desc id="presentation-paint-description">
          Three repeated demand records are outlined in cyan. Red finding marks
          identify a reported four-pixel boundary that does not distinguish the
          repeated objects.
        </desc>

        <rect width="680" height="372" rx="12" fill="#181b1d" />
        <rect x="22" y="20" width="436" height="332" rx="8" fill="#222629" />
        <text
          x="46"
          y="48"
          fill="#d9d4cf"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="16"
          fontWeight="700"
        >
          Demands
        </text>
        <text
          x="46"
          y="67"
          fill="#8f8580"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          application content
        </text>

        {RECORDS.map((record) => (
          <g key={record.index}>
            <rect
              x="46"
              y={record.y}
              width="388"
              height="58"
              rx="5"
              fill="#2b3033"
              stroke="#383e41"
            />
            <text
              x="62"
              y={record.y + 21}
              fill="#c0b9b3"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="10"
              fontWeight="700"
            >
              WHO
            </text>
            <rect x="62" y={record.y + 30} width="120" height="7" rx="3.5" fill="#8f8580" />
            <text
              x="193"
              y={record.y + 37}
              fill="#8f8580"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="9"
            >
              Demand {record.index}
            </text>

            <rect
              x="40"
              y={record.y - 6}
              width="400"
              height="70"
              rx="8"
              fill="none"
              stroke="#00d4ff"
              strokeWidth="2"
            />
            <text
              x="313"
              y={record.y - 10}
              fill="#00d4ff"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="9"
            >
              pattern:p0 #{record.index}
            </text>
          </g>
        ))}

        {[120, 196].map((y) => (
          <g key={y}>
            <line x1="460" y1={y} x2="522" y2={y} stroke="#ff1744" strokeWidth="2" />
            <line x1="460" y1={y - 5} x2="460" y2={y + 5} stroke="#ff1744" strokeWidth="2" />
            <line x1="522" y1={y - 5} x2="522" y2={y + 5} stroke="#ff1744" strokeWidth="2" />
          </g>
        ))}

        <rect x="482" y="42" width="174" height="72" rx="7" fill="#ff1744" fillOpacity="0.1" stroke="#ff1744" />
        <text
          x="494"
          y="65"
          fill="#ff6b7c"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
          fontWeight="700"
        >
          finding:f0
        </text>
        <text
          x="494"
          y="84"
          fill="#d9d4cf"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          repetition grammar
        </text>
        <text
          x="494"
          y="98"
          fill="#d9d4cf"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          collapse
        </text>

        <text
          x="482"
          y="144"
          fill="#ff6b7c"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          4px boundary
        </text>
        <text
          x="482"
          y="220"
          fill="#ff6b7c"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          4px boundary
        </text>

        <line x1="482" y1="265" x2="482" y2="314" stroke="#383e41" />
        <circle cx="482" cy="265" r="3" fill="#00d4ff" />
        <circle cx="482" cy="290" r="3" fill="#ff1744" />
        <text
          x="495"
          y="269"
          fill="#8f8580"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          repetition layer
        </text>
        <text
          x="495"
          y="294"
          fill="#8f8580"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          findings layer
        </text>
        <text
          x="482"
          y="335"
          fill="#8f8580"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
        >
          owner: r0:0
        </text>
      </svg>
    </div>
  );
}
