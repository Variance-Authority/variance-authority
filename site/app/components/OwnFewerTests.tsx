const TEST_Y = [64, 101, 138, 195, 232] as const;

/** Several tests may collapse to fewer distinct decisions worth retaining. */
export default function OwnFewerTests() {
  return (
    <div className="rounded-2xl border border-hairline bg-panel px-4 py-7 sm:px-8 sm:py-9">
      <svg
        viewBox="0 0 840 300"
        className="h-auto w-full"
        role="img"
        aria-label="Five tests converge on two distinct actionable decisions. One credible test is retained for each decision."
      >
        <text x="70" y="24" fill="#8f8580" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2">
          5 TESTS
        </text>
        <text x="356" y="24" fill="#8f8580" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2">
          2 DECISIONS
        </text>
        <text x="674" y="24" fill="#8f8580" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2">
          2 RETAINED
        </text>

        {TEST_Y.map((y, index) => (
          <g key={y}>
            <rect x="48" y={y - 13} width="142" height="26" rx="5" fill="#181b1d" stroke="#383e41" />
            <circle cx="68" cy={y} r="3.5" fill={index < 3 ? "#756d67" : "#8f8580"} />
            <path d={`M82 ${y}h78`} stroke="#756d67" strokeWidth="2" strokeLinecap="round" opacity="0.62" />
          </g>
        ))}

        <path d="M190 64C280 64 284 102 374 112M190 101C278 101 292 112 374 112M190 138C280 138 284 122 374 112" fill="none" stroke="#756d67" strokeWidth="1.5" opacity="0.72" />
        <path d="M190 195C282 195 290 215 374 215M190 232C282 232 290 215 374 215" fill="none" stroke="#756d67" strokeWidth="1.5" opacity="0.72" />

        <rect x="374" y="78" width="158" height="68" rx="8" fill="#181b1d" stroke="#ff4a19" strokeWidth="2" />
        <circle cx="400" cy="112" r="7" fill="#ff4a19" />
        <path d="M420 105h82M420 119h58" stroke="#f3f4f6" strokeWidth="3" strokeLinecap="round" opacity="0.9" />

        <rect x="374" y="181" width="158" height="68" rx="8" fill="#181b1d" stroke="#756d67" />
        <circle cx="400" cy="215" r="7" fill="#f3f4f6" />
        <path d="M420 208h82M420 222h58" stroke="#f3f4f6" strokeWidth="3" strokeLinecap="round" opacity="0.72" />

        <path d="M532 112h110" stroke="#ff4a19" strokeWidth="2" strokeLinecap="round" />
        <path d="m633 104 9 8-9 8" fill="none" stroke="#ff4a19" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M532 215h110" stroke="#756d67" strokeWidth="1.5" strokeLinecap="round" />
        <path d="m633 207 9 8-9 8" fill="none" stroke="#756d67" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        <rect x="674" y="91" width="126" height="42" rx="6" fill="#181b1d" stroke="#ff4a19" strokeWidth="2" />
        <circle cx="695" cy="112" r="4" fill="#ff4a19" />
        <path d="M710 112h66" stroke="#f3f4f6" strokeWidth="3" strokeLinecap="round" />

        <rect x="674" y="194" width="126" height="42" rx="6" fill="#181b1d" stroke="#756d67" />
        <circle cx="695" cy="215" r="4" fill="#f3f4f6" />
        <path d="M710 215h66" stroke="#f3f4f6" strokeWidth="3" strokeLinecap="round" opacity="0.72" />
      </svg>
    </div>
  );
}
