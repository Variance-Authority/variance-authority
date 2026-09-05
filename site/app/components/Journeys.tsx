/**
 * One component's stories as the review surface draws them: one timeline, a
 * trunk for the story the others vary from and every story that took its
 * path, and a numbered mark at every place the stories parted. An arm that
 * entered the region is lit; the line that fell through is dashed. Source
 * order runs left to right, and every line ends in the names of the stories
 * on it.
 *
 * The geometry is the review surface's own — the same step per fork, the same
 * row per branch, the same bend — so a reader who has seen one has seen the
 * other. Charcoal ground, ivory trunk, one orange for the path that entered,
 * per docs/visual-guidelines.md.
 */

const STEP = 176;
const GAP = 30;
const LEFT = 16;
const TOP = 34;

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

type Tone = "trunk" | "lit" | "dim";

interface Arm {
  /** The fork it leaves at; `-1` is where the trunk starts. */
  from: number;
  /** The fork it splits at, or the count of forks when it runs to the end. */
  at: number;
  /** The row it settles on, and the row it left. */
  y: number;
  parentY: number;
  tone: Tone;
  /** The lines of the case it entered, where the fork is a `switch`. */
  span?: string;
}

interface Mark {
  at: number;
  y: number;
  label: string;
}

interface Leaf {
  y: number;
  names: string;
  main?: boolean;
}

export interface Picture {
  forks: number;
  leaves: number;
  arms: Arm[];
  marks: Mark[];
  ends: Leaf[];
  label: string;
}

const x = (index: number) => LEFT + (index + 1) * STEP;
const y = (row: number) => TOP + row * GAP + GAP / 2;

/** How far past its fork a branch is still curving. */
const bendOf = (arm: Arm) => Math.min(STEP * 0.55, x(arm.at) - x(arm.from));

function path(arm: Arm): string {
  const x0 = x(arm.from);
  const x1 = x(arm.at);
  const y0 = y(arm.parentY);
  const y1 = y(arm.y);
  if (y0 === y1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const bend = bendOf(arm);
  const c = bend / 2;
  return `M ${x0} ${y0} C ${x0 + c} ${y0}, ${x0 + c} ${y1}, ${x0 + bend} ${y1} L ${x1} ${y1}`;
}

const STROKE: Record<Tone, { stroke: string; width: number; dash?: string }> = {
  trunk: { stroke: IVORY, width: 2.5 },
  lit: { stroke: ORANGE, width: 2 },
  dim: { stroke: WARM, width: 2, dash: "5 4" },
};

/** Three stories of one card, and the click handler only one of them ran. */
export const CART: Picture = {
  forks: 1,
  leaves: 2,
  arms: [
    { from: -1, at: 0, y: 1, parentY: 1, tone: "trunk" },
    { from: 0, at: 1, y: 0, parentY: 1, tone: "lit" },
    { from: 0, at: 1, y: 1, parentY: 1, tone: "dim" },
  ],
  marks: [{ at: 0, y: 1, label: "CartCard/onClick:51–58" }],
  ends: [
    { y: 0, names: "removing" },
    { y: 1, names: "item, verbose", main: true },
  ],
  label: "story:cart-card: 3 stories part at 1 place into 2 paths",
};

/**
 * A panel with a loading, an error, an empty and a full state. The `switch`
 * that returns early for the first two is one mark with an arm per case; the
 * `if` that returns for the third is a second mark, on the line that fell
 * through the first.
 */
export const PANEL: Picture = {
  forks: 2,
  leaves: 4,
  arms: [
    { from: -1, at: 0, y: 2, parentY: 2, tone: "trunk" },
    { from: 0, at: 2, y: 0, parentY: 2, tone: "lit", span: ":6" },
    { from: 0, at: 1, y: 2, parentY: 2, tone: "dim" },
    { from: 0, at: 2, y: 3, parentY: 2, tone: "lit", span: ":4" },
    { from: 1, at: 2, y: 1, parentY: 2, tone: "lit" },
    { from: 1, at: 2, y: 2, parentY: 2, tone: "dim" },
  ],
  marks: [
    { at: 0, y: 2, label: "Panel:4–6" },
    { at: 1, y: 2, label: "Panel:8" },
  ],
  ends: [
    { y: 0, names: "error" },
    { y: 1, names: "empty" },
    { y: 2, names: "full", main: true },
    { y: 3, names: "loading" },
  ],
  label: "story:panel: 4 stories part at 2 places into 4 paths",
};

export function JourneyTimeline({ picture }: { picture: Picture }) {
  const end = x(picture.forks);
  const width = end + 10 + 15 * 6.6 + LEFT;
  const height = TOP + picture.leaves * GAP + 8;
  const mono = "font-mono";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full"
      // Scales with its column, and scrolls rather than shrinks past legibility.
      style={{ minWidth: Math.round(width * 0.8) }}
      role="img"
      aria-label={picture.label}
    >
      {picture.arms.map((arm, n) => {
        const tone = STROKE[arm.tone];
        return (
          <path
            key={n}
            d={path(arm)}
            fill="none"
            stroke={tone.stroke}
            strokeWidth={tone.width}
            strokeDasharray={tone.dash}
            strokeLinecap="round"
          />
        );
      })}
      {picture.marks.map((mark, n) => (
        <g key={mark.label} transform={`translate(${x(mark.at)} ${y(mark.y)})`}>
          <text
            className={mono}
            x={-11}
            y={-7}
            textAnchor="end"
            fill={QUIET}
            fontSize={10.5}
          >
            {mark.label}
          </text>
          <circle r={7} fill={GROUND} stroke={IVORY} strokeWidth={1.5} />
          <text
            className={mono}
            y={3.5}
            textAnchor="middle"
            fill={IVORY}
            fontSize={9}
            fontWeight={700}
          >
            {n + 1}
          </text>
        </g>
      ))}
      {picture.arms
        .filter((arm) => arm.span)
        .map((arm) => (
          <text
            key={`${arm.from}-${arm.y}`}
            className={mono}
            x={x(arm.from) + bendOf(arm) + 4}
            y={y(arm.y) + 13}
            fill={QUIET}
            fontSize={10.5}
          >
            {arm.span}
          </text>
        ))}
      {picture.ends.map((leaf) => (
        <text
          key={leaf.names}
          className={mono}
          x={end + 10}
          y={y(leaf.y) + 3.5}
          fill={leaf.main ? IVORY : QUIET}
          fontSize={11.5}
          fontWeight={leaf.main ? 600 : 400}
        >
          {leaf.names}
        </text>
      ))}
    </svg>
  );
}

/** One mark, and every region the run recorded for it. */
export interface Fork {
  regions: readonly { region: string; lines: string }[];
  file: string;
}

/** The marks by number beneath the picture, each region at its full coordinate. */
export function Forks({ forks }: { forks: readonly Fork[] }) {
  return (
    <ol className="mt-3 grid gap-1.5">
      {forks.map((fork, n) => (
        <li
          key={fork.regions[0]?.lines}
          className="grid grid-cols-[1.1rem_1fr] items-baseline gap-x-2 text-xs leading-5"
        >
          <span className="inline-block h-[1.1rem] w-[1.1rem] rounded-full border border-ivory text-center font-mono text-[0.62rem] leading-[1.05rem] font-bold text-ivory">
            {n + 1}
          </span>
          <span className="min-w-0 break-words text-quiet">
            {fork.regions.map((row, i) => (
              <span key={row.lines}>
                {i === 0 ? null : ", "}
                <span className="font-mono text-ivory">{row.region}</span>{" "}
                {row.lines}
              </span>
            ))}{" "}
            in <span className="font-mono">{fork.file}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The docs figure: the panel's four states, and the two places they part. */
export default function Journeys() {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
        one component, four stories, two places they part
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-hairline bg-deep p-3">
        <JourneyTimeline picture={PANEL} />
      </div>
      <Forks
        forks={[
          {
            regions: [
              { region: "case Panel", lines: "line 4" },
              { region: "case Panel", lines: "line 6" },
              { region: "continuation Panel", lines: "lines 8–9" },
            ],
            file: "app/src/components/Panel.tsx",
          },
          {
            regions: [
              { region: "branch Panel", lines: "line 8" },
              { region: "continuation Panel", lines: "line 9" },
            ],
            file: "app/src/components/Panel.tsx",
          },
        ]}
      />
      <p className="mt-4 border-t border-hairline pt-4 text-xs leading-5 text-quiet">
        The <span className="font-mono text-ivory">switch</span> that returns
        early for a loading and an error state is one mark with an arm per
        case; the <span className="font-mono text-ivory">if</span> that returns
        for an empty one is a second mark, further along the line of the
        stories that fell through the first. The full story is the one the
        others vary from, and it runs level.
      </p>
    </div>
  );
}
