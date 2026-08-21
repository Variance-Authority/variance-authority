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
  { d: "M0 60 C 160 60, 220 44, 360 44 S 620 52, 800 48", delay: 0 },
  { d: "M0 96 C 200 96, 260 92, 420 92 S 640 88, 800 90", delay: 0.4 },
  { d: "M0 132 C 180 132, 240 140, 400 140 S 660 134, 800 136", delay: 0.8 },
  { d: "M0 168 C 220 168, 300 176, 460 176 S 680 172, 800 170", delay: 1.2 },
];

export default function Timelines() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg
        viewBox="0 0 800 220"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full opacity-[0.55]"
      >
        <defs>
          {/* A mask, not an opaque overlay — the dot-grid sits behind this and an
              overlay painted in the page colour would print the SVG's own rectangle. */}
          <linearGradient id="edgefade" x1="0" x2="1">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.14" stopColor="#fff" />
            <stop offset="0.86" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="edges">
            <rect x="0" y="0" width="800" height="220" fill="url(#edgefade)" />
          </mask>
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

        <g mask="url(#edges)">
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

          {/* the one that diverges, and its fold */}
          <path
            d="M0 114 C 200 114, 260 114, 380 114 C 470 114, 500 62, 620 54 S 740 46, 800 44"
            pathLength={1}
            fill="none"
            stroke="#ff4a19"
            strokeWidth="2"
            className="tl-glow"
            style={{ animationDelay: "1.6s, 4.2s" }}
          />
          <path
            d="M380 114 C 470 114, 500 160, 620 170 S 740 176, 800 178"
            pathLength={1}
            fill="none"
            stroke="#d83a13"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            className="tl-draw"
            style={{ animationDelay: "2s" }}
          />

          {/* the junction where it left the baseline */}
          <circle cx="380" cy="114" r="4" fill="#ff4a19" className="tl-pulse" />
          <circle
            cx="380"
            cy="114"
            r="4"
            fill="none"
            stroke="#ff4a19"
            className="tl-ring"
          />

          {/* settled markers along the quiet lines */}
          {[
            [180, 58],
            [520, 50],
            [300, 92],
            [640, 89],
            [240, 137],
            [700, 135],
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
