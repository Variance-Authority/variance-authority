/**
 * The Team card from examples/visual-review-case, before and after its edits,
 * laid out as the committed `after.png` shows it at five eighths of its size:
 * the plan's name top-left, the Choose button top-right and level with it, the
 * price below the name. The name grew onto a second line and every Choose
 * button was repainted, the Team card's among them; the price moved down only
 * because the name grew. The labels are the `components:` rows of the
 * example's committed `variance ask describe` answer: two causes, and one
 * collateral component.
 *
 * Ivory marks the causes, orange the collateral price, the shift a pixel count
 * cannot tell from a change, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

/** The card is 480×144 in after.png; every length below is five eighths of the page's. */
const CARD_X = 30;
const CARD_W = 300;
const CARD_H = 90;
const BEFORE_Y = 56;
const AFTER_Y = 206;
const INSET = 10;
const BUTTON = { x: 225, y: 10, width: 65, height: 25 };
const LINE_H = 10;
const LABEL_X = 372;

interface Label {
  y: number;
  /** Where the leader starts, on the after card. */
  from: { x: number; y: number };
  component: string;
  role: "cause" | "collateral";
  bands: readonly string[];
  focus?: boolean;
}

/** Pinned to examples/visual-review-case/artifacts/report.txt by its test. */
export const LABELS: readonly Label[] = [
  {
    y: 180,
    from: { x: CARD_X + BUTTON.x + BUTTON.width, y: AFTER_Y + BUTTON.y + 6 },
    component: "ChooseButton",
    role: "cause",
    bands: ["token"],
  },
  { y: 256, from: { x: CARD_X + 74, y: AFTER_Y + 29 }, component: "PlanName", role: "cause", bands: ["a11y", "geometry", "content"] },
  { y: 316, from: { x: CARD_X + 76, y: AFTER_Y + 67 }, component: "Price", role: "collateral", bands: ["geometry"], focus: true },
];

function Card({ y, title }: { y: number; title: string }) {
  return (
    <>
      <text className="font-mono" x={CARD_X} y={y - 16} fill={QUIET} fontSize={12}>
        {title}
      </text>
      <rect x={CARD_X} y={y} width={CARD_W} height={CARD_H} rx={8} fill={GROUND} stroke={WARM} strokeWidth={1.5} />
    </>
  );
}

export default function ShiftOrChange() {
  const left = CARD_X + INSET;
  const button = { x: CARD_X + BUTTON.x, width: BUTTON.width, height: BUTTON.height, rx: 5 };
  return (
    <svg
      viewBox="0 0 560 360"
      className="block h-auto w-full"
      role="img"
      aria-label="The Team pricing card before and after its edits, with the plan name top-left, the Choose button top-right level with it, and the price below the name. The plan name grows onto a second line and is a cause, changed in a11y, geometry and content. The Choose button is repainted, as every card's is, and is a cause, changed in token. The price moves down below the longer name and is reported collateral, changed in geometry alone."
    >
      <Card y={BEFORE_Y} title="before" />
      <rect x={left} y={BEFORE_Y + 12} width={30} height={LINE_H} rx={3} fill={QUIET} />
      <rect x={left} y={BEFORE_Y + 50} width={54} height={LINE_H} rx={3} fill={QUIET} />
      <rect {...button} y={BEFORE_Y + BUTTON.y} fill={GROUND} stroke={QUIET} strokeWidth={1.5} />

      <Card y={AFTER_Y} title="after" />
      <rect x={left} y={AFTER_Y + 12} width={104} height={LINE_H} rx={3} fill={IVORY} />
      <rect x={left} y={AFTER_Y + 24} width={60} height={LINE_H} rx={3} fill={IVORY} />
      <rect
        x={left}
        y={AFTER_Y + 50}
        width={54}
        height={LINE_H}
        rx={3}
        fill="none"
        stroke={WARM}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <path
        d={`M ${left + 60} ${AFTER_Y + 52} L ${left + 60} ${AFTER_Y + 68}`}
        stroke={ORANGE}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d={`M ${left + 56} ${AFTER_Y + 63} L ${left + 60} ${AFTER_Y + 69} L ${left + 64} ${AFTER_Y + 63}`}
        fill="none"
        stroke={ORANGE}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x={left} y={AFTER_Y + 62} width={54} height={LINE_H} rx={3} fill={ORANGE} />
      <rect {...button} y={AFTER_Y + BUTTON.y} fill={IVORY} />

      {LABELS.map((label) => (
        <g key={label.component}>
          <line
            x1={label.from.x}
            y1={label.from.y}
            x2={LABEL_X - 8}
            y2={label.y - 4}
            stroke={label.focus ? ORANGE : WARM}
            strokeWidth={1.5}
          />
          <text
            className="font-mono"
            x={LABEL_X}
            y={label.y - 8}
            fill={label.focus ? ORANGE : IVORY}
            fontSize={14}
          >
            {label.component}
          </text>
          <text
            className="font-mono"
            x={LABEL_X}
            y={label.y + 10}
            fill={label.focus ? ORANGE : QUIET}
            fontSize={12}
          >
            {label.role}
          </text>
          <text
            className="font-mono"
            x={LABEL_X}
            y={label.y + 26}
            fill={label.focus ? ORANGE : QUIET}
            fontSize={12}
          >
            {label.bands.join(", ")}
          </text>
        </g>
      ))}
    </svg>
  );
}
