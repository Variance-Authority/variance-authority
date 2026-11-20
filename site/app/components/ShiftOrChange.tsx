/**
 * The Team card from examples/visual-review-case, before and after its one
 * edit. The plan's name grew onto a second line and the Choose button was
 * repainted; the price below the name moved only because the name grew. The
 * labels are the report's own region lines: two causes, and one displaced
 * region.
 *
 * Ivory marks the causes, orange the displaced price, the shift a pixel count
 * cannot tell from a change, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const BEFORE_X = 30;
const AFTER_X = 196;
const CARD_W = 150;
const LABEL_X = 372;

interface Label {
  y: number;
  /** Where the leader starts, on the after card. */
  from: { x: number; y: number };
  component: string;
  line: string;
  focus?: boolean;
}

const LABELS: Label[] = [
  { y: 96, from: { x: AFTER_X + 136, y: 102 }, component: "PlanName", line: "cause · shape · 733px" },
  {
    y: 156,
    from: { x: AFTER_X + 94, y: 147 },
    component: "Price",
    line: "displaced · shape · 524px",
    focus: true,
  },
  { y: 254, from: { x: AFTER_X + 134, y: 254 }, component: "ChooseButton", line: "cause · colour · 3670px" },
];

function Card({ x, title }: { x: number; title: string }) {
  return (
    <>
      <text className="font-mono" x={x} y={40} fill={QUIET} fontSize={12}>
        {title}
      </text>
      <rect x={x} y={56} width={CARD_W} height={240} rx={8} fill={GROUND} stroke={WARM} strokeWidth={1.5} />
    </>
  );
}

export default function ShiftOrChange() {
  return (
    <svg
      viewBox="0 0 560 360"
      className="block h-auto w-full"
      role="img"
      aria-label="The Team pricing card before and after its edit. The plan name grows onto a second line and is a cause that changed in shape. The Choose button is repainted and is a cause that changed only in colour. The price moves down below the longer name and is reported displaced."
    >
      <Card x={BEFORE_X} title="before" />
      <rect x={BEFORE_X + 16} y={86} width={84} height={12} rx={3} fill={QUIET} />
      <rect x={BEFORE_X + 16} y={114} width={64} height={18} rx={3} fill={QUIET} />
      <rect x={BEFORE_X + 16} y={240} width={118} height={28} rx={6} fill={GROUND} stroke={QUIET} strokeWidth={1.5} />

      <Card x={AFTER_X} title="after" />
      <rect x={AFTER_X + 16} y={86} width={120} height={12} rx={3} fill={IVORY} />
      <rect x={AFTER_X + 16} y={104} width={84} height={12} rx={3} fill={IVORY} />
      <rect
        x={AFTER_X + 16}
        y={114}
        width={64}
        height={18}
        rx={3}
        fill="none"
        stroke={WARM}
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <path
        d={`M ${AFTER_X + 88} ${123} L ${AFTER_X + 88} ${140}`}
        stroke={ORANGE}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d={`M ${AFTER_X + 84} ${135} L ${AFTER_X + 88} ${141} L ${AFTER_X + 92} ${135}`}
        fill="none"
        stroke={ORANGE}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x={AFTER_X + 16} y={138} width={64} height={18} rx={3} fill={ORANGE} />
      <rect x={AFTER_X + 16} y={240} width={118} height={28} rx={6} fill={IVORY} />

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
            {label.line}
          </text>
        </g>
      ))}

    </svg>
  );
}
