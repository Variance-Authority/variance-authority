/**
 * The editor from the page's `import()` example, changed, and three tests at
 * one, two and three imports from it. The import edge, dotted, reaches the
 * editor from all three: each of them loads it. The run, solid, reaches it
 * only from the editor's own test. Every component in between adds a
 * condition, drawn as a diamond and named, where execution turns away; the
 * label under the turn says where it went instead.
 *
 * Ivory marks what ran, orange the changed module and the one run that
 * reaches it, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const TARGET = 440;
const TEST_X = 40;

interface Station {
  x: number;
  /** A component on the way, drawn as a box. */
  component?: string;
  /** A condition on the way, drawn as a diamond. */
  condition?: string;
}

interface Row {
  y: number;
  test: string;
  stations: Station[];
  /** The condition the run turns away at, and where it went instead. */
  turn: { x: number; to: string } | null;
}

const ROWS: Row[] = [
  { y: 72, test: "editor.test · 1 import", stations: [], turn: null },
  {
    y: 167,
    test: "comment-field.test · 2 imports",
    stations: [
      { x: 290, component: "CommentField" },
      { x: 390, condition: "double-click?" },
    ],
    turn: { x: 390, to: "textarea" },
  },
  {
    y: 262,
    test: "checkout.test · 3 imports",
    stations: [
      { x: 120, component: "Checkout" },
      { x: 205, condition: "last step?" },
      { x: 290, component: "CommentField" },
      { x: 390, condition: "double-click?" },
    ],
    turn: { x: 205, to: "step 1" },
  },
];

function Diamond({ x, y, reached }: { x: number; y: number; reached: boolean }) {
  return (
    <rect
      x={x - 7}
      y={y - 7}
      width={14}
      height={14}
      transform={`rotate(45 ${x} ${y})`}
      fill={GROUND}
      stroke={reached ? IVORY : WARM}
      strokeWidth={1.5}
    />
  );
}

export default function ConditionsOnTheWay() {
  return (
    <svg
      viewBox="0 0 560 360"
      className="block h-auto w-full"
      role="img"
      aria-label="A changed editor and three tests that load it. The editor's own test runs it. The comment field's test turns away at the double click and renders a textarea. The checkout test turns away at the last-step condition and stays on step 1."
    >
      <rect
        x={TARGET}
        y={34}
        width={110}
        height={262}
        rx={8}
        fill="rgba(255, 74, 25, 0.06)"
        stroke={ORANGE}
        strokeWidth={2}
      />
      <text
        className="font-mono"
        x={TARGET + 55}
        y={160}
        textAnchor="middle"
        fill={ORANGE}
        fontSize={14}
      >
        editor
      </text>
      <text
        className="font-mono"
        x={TARGET + 55}
        y={180}
        textAnchor="middle"
        fill={ORANGE}
        fontSize={12}
      >
        changed
      </text>

      {ROWS.map((row) => {
        const turn = row.turn;
        return (
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
            {turn === null ? (
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
                  d={`M ${TEST_X} ${row.y} L ${turn.x} ${row.y} C ${turn.x + 20} ${row.y}, ${turn.x + 20} ${row.y + 28}, ${turn.x + 40} ${row.y + 28}`}
                  fill="none"
                  stroke={IVORY}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <circle cx={turn.x + 43} cy={row.y + 28} r={3.5} fill={IVORY} />
                <text
                  className="font-mono"
                  x={turn.x + 47}
                  y={row.y + 48}
                  textAnchor="end"
                  fill={IVORY}
                  fontSize={12}
                >
                  {turn.to}
                </text>
              </>
            )}
            {row.stations.map((station) =>
              station.component ? (
                <g key={station.x}>
                  <rect
                    x={station.x - 50}
                    y={row.y - 13}
                    width={100}
                    height={26}
                    rx={5}
                    fill={GROUND}
                    stroke={turn && station.x < turn.x ? IVORY : WARM}
                    strokeWidth={1.5}
                  />
                  <text
                    className="font-mono"
                    x={station.x}
                    y={row.y + 4}
                    textAnchor="middle"
                    fill={turn && station.x < turn.x ? IVORY : QUIET}
                    fontSize={12}
                  >
                    {station.component}
                  </text>
                </g>
              ) : (
                <g key={station.x}>
                  <Diamond
                    x={station.x}
                    y={row.y}
                    reached={turn !== null && station.x <= turn.x}
                  />
                  <text
                    className="font-mono"
                    x={station.x}
                    y={row.y - 18}
                    textAnchor="middle"
                    fill={QUIET}
                    fontSize={12}
                  >
                    {station.condition}
                  </text>
                </g>
              ),
            )}
            <circle
              cx={TEST_X}
              cy={row.y}
              r={9}
              fill={turn === null ? IVORY : GROUND}
              stroke={turn === null ? IVORY : WARM}
              strokeWidth={2}
            />
            <text
              className="font-mono"
              x={TEST_X - 9}
              y={row.y - 32}
              fill={QUIET}
              fontSize={13}
            >
              {row.test}
            </text>
          </g>
        );
      })}

      <g transform="translate(40 344)">
        <line x1={0} y1={0} x2={28} y2={0} stroke={WARM} strokeWidth={1.5} strokeDasharray="2 5" />
        <text className="font-mono" x={36} y={5} fill={QUIET} fontSize={13}>
          loads
        </text>
        <line x1={110} y1={0} x2={138} y2={0} stroke={IVORY} strokeWidth={2} />
        <text className="font-mono" x={146} y={5} fill={QUIET} fontSize={13}>
          runs
        </text>
        <Diamond x={226} y={0} reached />
        <text className="font-mono" x={242} y={5} fill={QUIET} fontSize={13}>
          condition
        </text>
      </g>
    </svg>
  );
}
