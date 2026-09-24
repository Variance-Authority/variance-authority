/**
 * The same five tests and the same module, read twice. The import graph ends
 * every test at the module's edge, so a change anywhere in it selects all
 * five. The execution record follows each test's story into the branch it
 * ran, so a change to one branch selects the one test that ran it. One test
 * loads the module and runs none of it; its line stops at the edge, dashed.
 *
 * Ivory marks a selected test, orange the changed branch and the one story
 * through it, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const TESTS = [70, 118, 166, 214, 262];
const EDGE = 170;
const REGION_X = 250;
const REGIONS = [
  { y: 84, label: "branch", changed: false },
  { y: 150, label: "changed", changed: true },
  { y: 216, label: "branch", changed: false },
];
/** The region each test's story ran, or `null` for a test that only loaded. */
const STORY: readonly (number | null)[] = [0, 0, 1, 2, null];

const centre = (region: number) => REGIONS[region]!.y + 20;

function Panel({ record }: { record: boolean }) {
  const selected = (test: number) => !record || STORY[test] === 1;
  const count = record ? "1 of 5 run" : "5 of 5 run";
  return (
    <svg
      viewBox="0 0 400 300"
      className="block h-auto w-full"
      role="img"
      aria-label={
        record
          ? "Execution record: of five tests that load the module, only the one that ran the changed branch is selected"
          : "Import graph: all five tests that load the module are selected"
      }
    >
      <text className="font-mono" x={0} y={20} fill={IVORY} fontSize={13}>
        {record ? "execution record" : "import graph"}
      </text>
      <text
        className="font-mono"
        x={400}
        y={20}
        textAnchor="end"
        fill={QUIET}
        fontSize={12}
      >
        {count}
      </text>

      <rect
        x={EDGE}
        y={48}
        width={220}
        height={236}
        rx={8}
        fill="none"
        stroke={WARM}
        strokeWidth={1.5}
      />
      <text className="font-mono" x={EDGE + 12} y={68} fill={QUIET} fontSize={11}>
        module
      </text>
      {REGIONS.map((region) => (
        <g key={region.y}>
          <rect
            x={REGION_X}
            y={region.y}
            width={124}
            height={40}
            rx={5}
            fill={region.changed ? "rgba(255, 74, 25, 0.08)" : "none"}
            stroke={region.changed ? ORANGE : WARM}
            strokeWidth={region.changed ? 2 : 1.5}
          />
          <text
            className="font-mono"
            x={REGION_X + 62}
            y={region.y + 24}
            textAnchor="middle"
            fill={region.changed ? ORANGE : QUIET}
            fontSize={11}
          >
            {region.label}
          </text>
        </g>
      ))}

      {TESTS.map((y, test) => {
        const story = STORY[test];
        if (!record) {
          return (
            <line
              key={y}
              x1={39}
              y1={y}
              x2={EDGE}
              y2={y}
              stroke={WARM}
              strokeWidth={2}
            />
          );
        }
        if (story === null) {
          return (
            <line
              key={y}
              x1={39}
              y1={y}
              x2={EDGE}
              y2={y}
              stroke={WARM}
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          );
        }
        const to = centre(story);
        const lit = story === 1;
        return (
          <path
            key={y}
            d={`M 39 ${y} C 140 ${y}, ${REGION_X - 90} ${to}, ${REGION_X} ${to}`}
            fill="none"
            stroke={lit ? ORANGE : WARM}
            strokeWidth={lit ? 3 : 2}
            strokeLinecap="round"
          />
        );
      })}

      {TESTS.map((y, test) => (
        <circle
          key={y}
          cx={30}
          cy={y}
          r={9}
          fill={selected(test) ? IVORY : GROUND}
          stroke={selected(test) ? IVORY : WARM}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

/** One edit, read by the import graph and by the execution record. */
export default function StoriesNotImports() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
      <Panel record={false} />
      <Panel record />
    </div>
  );
}
