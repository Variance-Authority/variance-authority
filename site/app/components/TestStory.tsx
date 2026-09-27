/**
 * One test's code read twice. File by file, as a reader opens it, each
 * function and branch either ran or never ran, and nothing says in what
 * order. The test story is the same code joined in the order the test ran
 * it, each stop numbered by its step, with the loop that went round twice
 * and the branch the test never took. The code and the numbers are the
 * example on the test-stories page, recorded from a real run, so the figure
 * and the printed story can be read side by side.
 *
 * Ivory marks code that ran, dashed warm grey code that never ran, and one
 * orange path the route, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const FILES = [
  { x: 4, name: "cart.ts" },
  { x: 136, name: "price.ts" },
  { x: 268, name: "format.ts" },
];

interface Place {
  label: string;
  x: number;
  y: number;
  width: number;
  ran: boolean;
  /** The steps at which the test was here. */
  steps: readonly number[];
}

const PLACES: readonly Place[] = [
  { label: "removeItem", x: 18, y: 84, width: 100, ran: true, steps: [1, 3, 6] },
  { label: "filter.arg0", x: 18, y: 128, width: 100, ran: true, steps: [2] },
  { label: "if 14 then", x: 18, y: 172, width: 100, ran: false, steps: [] },
  { label: "notify", x: 18, y: 232, width: 100, ran: true, steps: [7] },
  { label: "applyTier", x: 150, y: 110, width: 100, ran: true, steps: [4] },
  { label: "formatPrice", x: 282, y: 150, width: 100, ran: true, steps: [5] },
];

const HEIGHT = 26;

/** The route between the places, in step order; the loop back is drawn apart. */
const ROUTE = [
  "M 76 110 L 76 128",
  "M 96 128 L 96 110",
  "M 118 97 C 134 97, 134 123, 150 123",
  "M 250 123 C 266 123, 266 163, 282 163",
  "M 18 104 C 12 104, 10 110, 10 118 L 10 237 C 10 245, 12 245, 18 245",
];
const LOOP = "M 332 176 L 332 200 C 332 208, 326 210, 318 210 L 132 210 C 126 210, 124 206, 124 200 L 124 112 C 124 106, 122 104, 118 104";

function Step({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={7.5} fill={GROUND} stroke={ORANGE} strokeWidth={1.5} />
      <text className="font-mono" y={3.2} textAnchor="middle" fill={IVORY} fontSize={9} fontWeight={700}>
        {n}
      </text>
    </g>
  );
}

function Panel({ story }: { story: boolean }) {
  return (
    <svg
      viewBox="0 0 400 280"
      className="block h-auto w-full"
      role="img"
      aria-label={
        story
          ? "Test story: the same code joined in the order the test ran it, steps 1 to 7, with steps 3 to 5 run twice and one branch never taken"
          : "File by file: five pieces of code the test ran and one branch it never ran, with no order"
      }
    >
      <text className="font-mono" x={0} y={18} fill={IVORY} fontSize={13}>
        {story ? "test story" : "file by file"}
      </text>
      <text className="font-mono" x={400} y={18} textAnchor="end" fill={QUIET} fontSize={12}>
        {story ? "in what order, how often" : "what ran"}
      </text>

      {FILES.map((file) => (
        <g key={file.name}>
          <rect x={file.x} y={40} width={128} height={232} rx={8} fill="none" stroke={WARM} strokeWidth={1.5} />
          <text className="font-mono" x={file.x + 9} y={60} fill={QUIET} fontSize={10}>
            {file.name}
          </text>
        </g>
      ))}

      {story &&
        ROUTE.map((d) => (
          <path key={d} d={d} fill="none" stroke={ORANGE} strokeWidth={2.5} strokeLinecap="round" />
        ))}
      {story && (
        <>
          <path d={LOOP} fill="none" stroke={ORANGE} strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />
          <text className="font-mono" x={228} y={226} textAnchor="middle" fill={ORANGE} fontSize={11}>
            ×2
          </text>
        </>
      )}

      {PLACES.map((place) => (
        <g key={place.label}>
          <rect
            x={place.x}
            y={place.y}
            width={place.width}
            height={HEIGHT}
            rx={5}
            fill={place.ran ? "rgba(243, 244, 246, 0.06)" : GROUND}
            stroke={place.ran ? IVORY : WARM}
            strokeWidth={1.5}
            strokeDasharray={place.ran ? undefined : "4 3"}
          />
          <text
            className="font-mono"
            x={place.x + place.width / 2}
            y={place.y + 17}
            textAnchor="middle"
            fill={place.ran ? IVORY : QUIET}
            fontSize={place.ran ? 10 : 9.5}
          >
            {story && !place.ran ? `${place.label} ✗` : place.label}
          </text>
        </g>
      ))}

      {story && (
        <>
          {PLACES.flatMap((place) =>
            place.steps.map((n, i) => <Step key={n} x={place.x + 2 + i * 18} y={place.y - 2} n={n} />),
          )}
        </>
      )}
    </svg>
  );
}

/** One test's code: what ran, then the order and the counts. */
export default function TestStory() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
      <Panel story={false} />
      <Panel story />
    </div>
  );
}
