/**
 * One test's code read twice. The journey is the set: each function and
 * branch either ran or never ran, and nothing says in what order. The test
 * story is the same code joined in the order the test ran it, each stop
 * numbered by its step, with the loop that went round twice and the branch
 * the test never took. The code and the numbers are the example on the
 * test-stories page, so the figure and the printed story can be read side by
 * side.
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
  { x: 4, name: "cart.test.ts" },
  { x: 102, name: "cart.ts" },
  { x: 200, name: "price.ts" },
  { x: 298, name: "format.ts" },
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
  { label: "beforeEach", x: 13, y: 84, width: 78, ran: true, steps: [1] },
  { label: "removeItem", x: 111, y: 96, width: 78, ran: true, steps: [3, 6] },
  { label: "if 14 then", x: 113, y: 160, width: 78, ran: false, steps: [] },
  { label: "notify", x: 111, y: 232, width: 78, ran: true, steps: [7] },
  { label: "applyTier", x: 209, y: 130, width: 78, ran: true, steps: [4] },
  { label: "formatPrice", x: 307, y: 170, width: 78, ran: true, steps: [5] },
];

const HEIGHT = 26;

/** The route between the places, in step order; the loop back is drawn apart. */
const ROUTE = [
  "M 91 97 C 101 97, 101 105, 111 105",
  "M 189 105 C 199 105, 199 137, 209 137",
  "M 287 143 C 297 143, 297 183, 307 183",
  "M 209 149 C 199 149, 199 117, 189 117",
  "M 111 116 C 106 116, 106 120, 106 128 L 106 237 C 106 245, 106 245, 111 245",
];
const LOOP = "M 346 196 C 346 232, 248 210, 248 156";

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
          ? "Test story: the same code joined in the order the test ran it, steps 1 to 7, with a loop that ran twice and one branch never taken"
          : "Journey: five pieces of code the test ran and one branch it never ran, with no order"
      }
    >
      <text className="font-mono" x={0} y={18} fill={IVORY} fontSize={13}>
        {story ? "test story" : "journey"}
      </text>
      <text className="font-mono" x={400} y={18} textAnchor="end" fill={QUIET} fontSize={12}>
        {story ? "in what order, how often" : "what ran"}
      </text>

      {FILES.map((file) => (
        <g key={file.name}>
          <rect x={file.x} y={40} width={96} height={232} rx={8} fill="none" stroke={WARM} strokeWidth={1.5} />
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
          <text className="font-mono" x={322} y={232} textAnchor="middle" fill={ORANGE} fontSize={11}>
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
          <Step x={101} y={101} n={2} />
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
