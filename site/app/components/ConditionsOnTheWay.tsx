/**
 * Three tests one, two and three imports away from a changed module. The
 * import edge, dotted, reaches the module from all three: each of them loads
 * it. The run, solid, reaches it only from the nearest; every module in
 * between adds a condition, drawn as a diamond, where execution can turn
 * away before it gets there.
 *
 * Ivory marks a selected test, orange the changed module and the one run that
 * reaches it, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const TARGET = 420;
const TEST_X = 40;

interface Row {
  y: number;
  hops: string;
  /** Modules between the test and the target. */
  between: number[];
  /** Where the run turns away, or `null` when it reaches the target. */
  turn: number | null;
}

const ROWS: Row[] = [
  { y: 62, hops: "1 import", between: [], turn: null },
  { y: 142, hops: "2 imports", between: [190], turn: 270 },
  { y: 222, hops: "3 imports", between: [150, 300], turn: 220 },
];

export default function ConditionsOnTheWay() {
  return (
    <svg
      viewBox="0 0 560 290"
      className="block h-auto w-full"
      role="img"
      aria-label="Three tests load a changed module through one, two and three imports; only the nearest runs it, because each module in between adds a condition that sends execution elsewhere"
    >
      <rect
        x={TARGET}
        y={30}
        width={130}
        height={214}
        rx={8}
        fill="rgba(255, 74, 25, 0.06)"
        stroke={ORANGE}
        strokeWidth={2}
      />
      <text
        className="font-mono"
        x={TARGET + 65}
        y={142}
        textAnchor="middle"
        fill={ORANGE}
        fontSize={14}
      >
        changed
      </text>

      {ROWS.map((row) => (
        <g key={row.y}>
          <line
            x1={TEST_X}
            y1={row.y}
            x2={TARGET}
            y2={row.y}
            stroke={WARM}
            strokeWidth={1.5}
            strokeDasharray="2 5"
          />
          {row.turn === null ? (
            <line
              x1={TEST_X}
              y1={row.y}
              x2={TARGET}
              y2={row.y}
              stroke={ORANGE}
              strokeWidth={3}
              strokeLinecap="round"
            />
          ) : (
            <>
              <path
                d={`M ${TEST_X} ${row.y} L ${row.turn} ${row.y} C ${row.turn + 30} ${row.y}, ${row.turn + 30} ${row.y + 30}, ${row.turn + 60} ${row.y + 30}`}
                fill="none"
                stroke={IVORY}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle cx={row.turn + 64} cy={row.y + 30} r={3.5} fill={WARM} />
              <rect
                x={row.turn - 7}
                y={row.y - 7}
                width={14}
                height={14}
                transform={`rotate(45 ${row.turn} ${row.y})`}
                fill={GROUND}
                stroke={IVORY}
                strokeWidth={1.5}
              />
            </>
          )}
          {row.between.map((x) => (
            <rect
              key={x}
              x={x - 26}
              y={row.y - 13}
              width={52}
              height={26}
              rx={5}
              fill={GROUND}
              stroke={WARM}
              strokeWidth={1.5}
            />
          ))}
          <circle
            cx={TEST_X}
            cy={row.y}
            r={9}
            fill={row.turn === null ? IVORY : GROUND}
            stroke={row.turn === null ? IVORY : WARM}
            strokeWidth={2}
          />
          <text
            className="font-mono"
            x={TEST_X - 9}
            y={row.y - 18}
            fill={QUIET}
            fontSize={13}
          >
            {row.hops}
          </text>
        </g>
      ))}

      <g transform="translate(40 276)">
        <line x1={0} y1={0} x2={28} y2={0} stroke={WARM} strokeWidth={1.5} strokeDasharray="2 5" />
        <text className="font-mono" x={36} y={5} fill={QUIET} fontSize={13}>
          loads
        </text>
        <line x1={110} y1={0} x2={138} y2={0} stroke={IVORY} strokeWidth={2} />
        <text className="font-mono" x={146} y={5} fill={QUIET} fontSize={13}>
          runs
        </text>
        <rect
          x={220}
          y={-6}
          width={12}
          height={12}
          transform="rotate(45 226 0)"
          fill={GROUND}
          stroke={IVORY}
          strokeWidth={1.5}
        />
        <text className="font-mono" x={242} y={5} fill={QUIET} fontSize={13}>
          condition
        </text>
      </g>
    </svg>
  );
}
