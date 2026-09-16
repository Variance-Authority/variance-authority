const EVIDENCE = [
  { label: "source", x: 170, y: 78 },
  { label: "execution", x: 170, y: 252 },
  { label: "interface", x: 630, y: 78 },
  { label: "history", x: 630, y: 252 },
] as const;

/** Independent evidence routes meeting at one bounded decision. */
export default function EvidenceMap() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline bg-panel p-4 sm:p-6">
      <div
        className="sm:hidden"
        role="img"
        aria-label="A question draws independently from source, execution, interface, and history evidence, then produces a supported action with a visible limit."
      >
        <div className="mx-auto w-fit rounded-full border border-orange bg-deep px-7 py-5 text-center">
          <p className="font-mono text-[9px] tracking-[0.16em] text-orange uppercase">
            question
          </p>
          <p className="mt-1 text-sm font-semibold text-ivory">one decision</p>
        </div>
        <div className="mx-auto h-5 w-px bg-hairline" aria-hidden="true" />
        <div className="grid grid-cols-2 gap-2">
          {EVIDENCE.map((item) => (
            <div key={item.label} className="flex items-center gap-2 rounded-lg border border-hairline bg-deep px-3 py-3">
              <span className={`h-2.5 w-2.5 rounded-full ${item.label === "execution" ? "bg-orange" : "bg-warm"}`} aria-hidden="true" />
              <span className="text-sm font-semibold text-ivory">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="mx-auto h-5 w-px bg-orange" aria-hidden="true" />
        <div className="rounded-lg border border-green/60 bg-green/[0.05] px-4 py-3 text-center text-sm text-ivory">
          supported action + visible limit
        </div>
      </div>
      <svg
        viewBox="0 0 800 360"
        className="mx-auto hidden min-w-[44rem] max-w-4xl sm:block"
        role="img"
        aria-labelledby="evidence-map-title evidence-map-description"
      >
        <title id="evidence-map-title">Evidence routes into one decision</title>
        <desc id="evidence-map-description">
          Source, execution, interface, and history evidence remain independent.
          A question uses only the routes it needs and the decision states where
          their support ends.
        </desc>
        <defs>
          <pattern id="evidence-dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#383e41" opacity="0.55" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="800" height="360" rx="16" fill="#181b1d" />
        <rect x="0" y="0" width="800" height="360" rx="16" fill="url(#evidence-dot-grid)" />

        {EVIDENCE.map((item) => (
          <g key={item.label}>
            <path
              d={`M${item.x < 400 ? item.x + 105 : item.x - 105} ${item.y + 25} C${item.x < 400 ? 330 : 470} ${item.y + 25}, ${item.x < 400 ? 330 : 470} 180, ${item.x < 400 ? 350 : 450} 180`}
              fill="none"
              stroke="#756d67"
              strokeWidth="2"
            />
            <rect x={item.x - 105} y={item.y} width="210" height="50" rx="7" fill="#24282a" stroke="#383e41" />
            <circle cx={item.x - 74} cy={item.y + 25} r="7" fill={item.label === "execution" ? "#ff4a19" : "#756d67"} />
            <text x={item.x - 55} y={item.y + 31} fill="#f3f4f6" fontFamily="Inter, sans-serif" fontSize="16" fontWeight="600">
              {item.label}
            </text>
          </g>
        ))}

        <g>
          <circle cx="400" cy="180" r="72" fill="#1e2224" stroke="#ff4a19" strokeWidth="2" />
          <circle cx="400" cy="180" r="51" fill="none" stroke="#383e41" strokeWidth="1" />
          <text x="400" y="174" textAnchor="middle" fill="#ff4a19" fontFamily="JetBrains Mono, monospace" fontSize="12" letterSpacing="2">
            QUESTION
          </text>
          <text x="400" y="198" textAnchor="middle" fill="#f3f4f6" fontFamily="Inter, sans-serif" fontSize="18" fontWeight="700">
            one decision
          </text>
        </g>

        <path d="M400 252v38" stroke="#ff4a19" strokeWidth="2" />
        <path d="m394 283 6 8 6-8" fill="none" stroke="#ff4a19" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="277" y="296" width="246" height="42" rx="7" fill="#24282a" stroke="#7fa28c" />
        <text x="400" y="322" textAnchor="middle" fill="#f3f4f6" fontFamily="Inter, sans-serif" fontSize="14">
          supported action + visible limit
        </text>
      </svg>
    </div>
  );
}
