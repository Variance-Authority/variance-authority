"use client";

/**
 * The hero's living backdrop: a sheaf of baselines running left to right, one
 * of which diverges. Everything is drawn, scanned and re-drawn on a loop, so
 * the page reads as a monitor rather than a poster.
 *
 * Not the TVA's palette — charcoal ground, ivory baselines, one variance
 * orange path, per docs/visual-guidelines.md.
 */

const BASELINES = [
  { d: "M0 40 C 160 40, 220 30, 360 30 S 620 36, 800 32", delay: 0 },
  { d: "M0 98 C 200 98, 260 94, 420 94 S 640 90, 800 92", delay: 0.4 },
  { d: "M0 140 C 180 140, 240 148, 400 148 S 660 142, 800 144", delay: 0.8 },
  { d: "M0 178 C 220 178, 300 186, 460 186 S 680 182, 800 180", delay: 1.2 },
];

export default function Timelines({
  /**
   * A window onto the 800×220 drawing. The default shows all of it; a caller
   * whose box is nowhere near 3.6:1 passes a narrower window, because
   * `slice` would otherwise crop the fork away and leave four straight lines.
   */
  view = "0 0 800 220",
  className = "",
}: {
  view?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      // The side fade is a CSS mask on the box rather than an SVG mask in the
      // drawing's own coordinates, so that it lands on the visible edges
      // whatever window `view` opens.
      className={`pointer-events-none absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_13%,black_87%,transparent)] ${className}`}
    >
      <svg
        viewBox={view}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full opacity-[0.62]"
      >
        <defs>
          <linearGradient id="scanline" x1="0" x2="1">
            <stop offset="0" stopColor="#ff4a19" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ff4a19" stopOpacity="0.22" />
            <stop offset="1" stopColor="#ff4a19" stopOpacity="0" />
          </linearGradient>
          {/* Without this the sweep is a rectangle with two hard horizontal edges. */}
          <linearGradient id="scanfade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.5" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="scanmask">
            <rect x="0" y="0" width="800" height="220" fill="url(#scanfade)" />
          </mask>
        </defs>

        <g>
          {/* the settled baselines */}
          {BASELINES.map((b, i) => (
            <path
              key={i}
              d={b.d}
              pathLength={1}
              fill="none"
              stroke="#756d67"
              strokeWidth="1.25"
              className="tl-draw"
              style={{ animationDelay: `${b.delay}s` }}
            />
          ))}

          {/* The one that diverges, and its fold. It branches at 70% of the
              width, which on the hero is the open quarter beside the headline
              — the caller fades this whole sheaf out over the type, so the
              divergence is the part that stays at full strength. */}
          <path
            d="M0 118 C 220 118, 400 118, 560 118 C 640 118, 662 84, 722 76 S 782 70, 800 68"
            pathLength={1}
            fill="none"
            stroke="#ff4a19"
            strokeWidth="2"
            className="tl-glow"
            style={{ animationDelay: "1.6s, 4.2s" }}
          />
          <path
            d="M560 118 C 640 118, 662 152, 722 160 S 782 166, 800 168"
            pathLength={1}
            fill="none"
            stroke="#d83a13"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            className="tl-draw"
            style={{ animationDelay: "2s" }}
          />

          {/* the junction where it left the baseline */}
          <circle cx="560" cy="118" r="4" fill="#ff4a19" className="tl-pulse" />
          <circle
            cx="560"
            cy="118"
            r="4"
            fill="none"
            stroke="#ff4a19"
            className="tl-ring"
          />

          {/* settled markers along the quiet lines */}
          {[
            [180, 34],
            [520, 32],
            [300, 95],
            [640, 91],
            [240, 145],
            [700, 143],
          ].map(([cx, cy], i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r="2.5"
              fill="#8f8580"
              className="tl-blink"
              style={{ animationDelay: `${i * 0.5}s` }}
            />
          ))}

          {/* the sweep that reads them */}
          <g mask="url(#scanmask)">
            <rect
              x="0"
              y="0"
              width="200"
              height="220"
              fill="url(#scanline)"
              className="tl-scan"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
