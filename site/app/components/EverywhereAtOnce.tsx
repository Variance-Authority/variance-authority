const CX = 260;
const CY = 205;
const R = 135;

/**
 * Seven places on one ring, clockwise from the top. The first six are built, in
 * the order the orange path runs; the seventh is the next one that path makes
 * cheap, so it is drawn open.
 */
const PLACES = [
  { label: "visual review", dx: 0, dy: -20, anchor: "middle" },
  { label: "selection", dx: 16, dy: 5, anchor: "start" },
  { label: "coverage", dx: 16, dy: 5, anchor: "start" },
  { label: "distill", dx: 0, dy: 32, anchor: "middle" },
  { label: "orientation", dx: 0, dy: 32, anchor: "middle" },
  { label: "services", dx: -16, dy: 5, anchor: "end" },
  { label: "next", dx: -16, dy: 5, anchor: "end" },
] as const;

function at(index: number) {
  const angle = ((-90 + (index * 360) / PLACES.length) * Math.PI) / 180;
  return {
    x: Math.round((CX + R * Math.cos(angle)) * 10) / 10,
    y: Math.round((CY + R * Math.sin(angle)) * 10) / 10,
  };
}

const POINTS = PLACES.map((_, index) => at(index));
const BUILT = POINTS.length - 1;
const first = POINTS[0]!;
const last = POINTS[BUILT - 1]!;
const next = POINTS[BUILT]!;

/** Every capability works from one centre at once; each was built beside the last. */
export default function EverywhereAtOnce() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-hairline bg-panel px-5 py-6 sm:px-8"
      role="img"
      aria-label="One centre with six arms, each ending at a capability on a ring: visual review, selection, coverage, distill, orientation and services. All six work from the centre at once. An orange path starts at visual review and runs around the ring through each capability, then continues as a dashed line to an open place marked next."
    >
      <p className="!m-0 font-mono text-[10px] tracking-[0.17em] text-quiet uppercase">
        everywhere at once
      </p>
      <svg
        viewBox="0 0 520 390"
        className="mx-auto mt-2 block h-auto w-full max-w-xl"
        aria-hidden="true"
      >
        <g fill="none" stroke="currentColor" className="text-hairline">
          <circle cx={CX} cy={CY} r="55" strokeWidth="1.5" />
          <circle cx={CX} cy={CY} r="95" strokeWidth="1" opacity="0.7" />
          <circle cx={CX} cy={CY} r="170" strokeWidth="1" strokeDasharray="2 6" />
        </g>

        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-warm">
          {POINTS.slice(0, BUILT).map((point, index) => (
            <line key={index} x1={CX} y1={CY} x2={point.x} y2={point.y} />
          ))}
          <line
            x1={CX}
            y1={CY}
            x2={next.x}
            y2={next.y}
            strokeDasharray="3 5"
            opacity="0.5"
          />
        </g>

        <g fill="none" stroke="currentColor" strokeLinecap="round" className="text-orange">
          <path
            d={`M${first.x} ${first.y} A${R} ${R} 0 1 1 ${last.x} ${last.y}`}
            strokeWidth="3"
          />
          <path
            d={`M${last.x} ${last.y} A${R} ${R} 0 0 1 ${next.x} ${next.y}`}
            strokeWidth="2"
            strokeDasharray="4 6"
          />
        </g>

        <circle
          cx={CX}
          cy={CY}
          r="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-orange"
          opacity="0.35"
        />
        <circle cx={CX} cy={CY} r="7" fill="currentColor" className="text-orange" />

        {POINTS.map((point, index) => {
          const place = PLACES[index]!;
          const open = index === BUILT;
          return (
            <g key={place.label}>
              <circle
                cx={point.x}
                cy={point.y}
                r="8"
                strokeWidth="2"
                stroke="currentColor"
                strokeDasharray={open ? "3 3" : undefined}
                className={`fill-deep ${open ? "text-warm" : "text-ivory"}`}
              />
              <text
                x={point.x + place.dx}
                y={point.y + place.dy}
                textAnchor={place.anchor}
                fill="currentColor"
                className={`font-mono text-[16px] tracking-[0.08em] uppercase ${
                  open ? "text-quiet" : "text-ivory"
                }`}
              >
                {place.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
