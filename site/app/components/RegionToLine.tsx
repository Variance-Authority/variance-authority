/**
 * One region of examples/visual-review-case's committed `variance ask
 * describe` answer, unfolded top to bottom: the region the pixels changed in,
 * the component that painted it, the landmark path a screen reader takes to
 * it, and the line the component is declared at.
 *
 * Ivory marks each step of the chain, orange the line it ends at, per
 * docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const BOX_X = 150;
const BOX_W = 390;
const BOX_H = 30;

interface Step {
  y: number;
  text: string;
  /** Hops of the landmark path are drawn smaller, inset under their bracket. */
  hop?: boolean;
  focus?: boolean;
}

/** Pinned to examples/visual-review-case/artifacts/report.txt by its test. */
export const STEPS: readonly Step[] = [
  { y: 20, text: "cause 3670px at 360,160 104×40" },
  { y: 68, text: "ChooseButton" },
  { y: 116, text: "main", hop: true },
  { y: 152, text: 'region "Plans"', hop: true },
  { y: 188, text: "list item 2 of 3", hop: true },
  { y: 224, text: 'button "Choose"', hop: true },
  { y: 300, text: "examples/visual-review-case/src/plans.js:53", focus: true },
];

const KINDS = [
  { y: 39, text: "region" },
  { y: 87, text: "component" },
  { y: 177, text: "landmark path" },
  { y: 319, text: "declared at" },
];

export default function RegionToLine() {
  return (
    <svg
      viewBox="0 0 560 360"
      className="block h-auto w-full"
      role="img"
      aria-label="A cause region of 3670 pixels at 360,160, 104 by 40, leads to the component ChooseButton; then along the landmark path main, region Plans, list item 2 of 3, button Choose; and ends at examples/visual-review-case/src/plans.js line 53."
    >
      <line x1={BOX_X + 20} y1={20 + BOX_H} x2={BOX_X + 20} y2={300} stroke={WARM} strokeWidth={1.5} />
      <path d={`M ${BOX_X + 6} 116 L ${BOX_X - 2} 116 L ${BOX_X - 2} 248 L ${BOX_X + 6} 248`} fill="none" stroke={QUIET} strokeWidth={1.5} />

      {KINDS.map((kind) => (
        <text
          key={kind.text}
          className="font-mono"
          x={BOX_X - 14}
          y={kind.y}
          textAnchor="end"
          fill={kind.text === "declared at" ? ORANGE : QUIET}
          fontSize={12}
        >
          {kind.text}
        </text>
      ))}

      {STEPS.map((step) => {
        const x = step.hop ? BOX_X + 40 : BOX_X;
        const height = step.hop ? 24 : BOX_H;
        return (
          <g key={step.text}>
            <rect
              x={x}
              y={step.y}
              width={BOX_X + BOX_W - x}
              height={height}
              rx={step.hop ? 5 : 6}
              fill={step.focus ? "rgba(255, 74, 25, 0.06)" : GROUND}
              stroke={step.focus ? ORANGE : step.hop ? WARM : IVORY}
              strokeWidth={step.focus ? 2 : 1.5}
            />
            <text
              className="font-mono"
              x={x + 14}
              y={step.y + height / 2 + 4.5}
              fill={step.focus ? ORANGE : IVORY}
              fontSize={step.focus ? 13 : step.hop ? 12 : 14}
            >
              {step.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
