/**
 * The bands each component of examples/visual-review-case changed in, as the
 * report lists them: the button in `token` alone, the name in `a11y`,
 * `geometry` and `content`, the displaced price in `geometry` alone. No
 * component changed in `texture`, so its column is empty. Each row ends with
 * the class of its region's pixels.
 *
 * Ivory marks a band that changed, orange the button: the most pixels of the
 * three, and a change in one style value alone, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";
const GROUND = "#181b1d";

const BANDS = ["a11y", "geometry", "token", "content", "texture"] as const;
const COLUMN_X = [168, 230, 292, 354, 416];
const REGION_X = 470;

interface Row {
  component: string;
  role: "cause" | "displaced";
  bands: readonly (typeof BANDS)[number][];
  region: string;
  focus?: boolean;
}

const ROWS: Row[] = [
  { component: "ChooseButton", role: "cause", bands: ["token"], region: "colour", focus: true },
  { component: "PlanName", role: "cause", bands: ["a11y", "geometry", "content"], region: "shape" },
  { component: "Price", role: "displaced", bands: ["geometry"], region: "shape" },
];

const rowY = (index: number) => 132 + index * 70;

export default function ChangeKinds() {
  return (
    <svg
      viewBox="0 0 560 360"
      className="block h-auto w-full"
      role="img"
      aria-label="A grid of three components against five bands: a11y, geometry, token, content and texture. ChooseButton, a cause, changed in token alone and its region changed in colour. PlanName, a cause, changed in a11y, geometry and content, in shape. Price, displaced, changed in geometry alone, in shape. No component changed in texture."
    >
      {BANDS.map((band, column) => (
        <text
          key={band}
          className="font-mono"
          x={COLUMN_X[column]}
          y={70}
          textAnchor="middle"
          fill={band === "texture" ? QUIET : IVORY}
          fontSize={12}
        >
          {band}
        </text>
      ))}
      <text className="font-mono" x={REGION_X + 30} y={70} textAnchor="middle" fill={IVORY} fontSize={12}>
        region
      </text>
      <line x1={24} y1={88} x2={536} y2={88} stroke={WARM} strokeWidth={1} />

      <rect
        x={COLUMN_X[4]! - 26}
        y={100}
        width={52}
        height={204}
        rx={6}
        fill="none"
        stroke={WARM}
        strokeWidth={1.5}
        strokeDasharray="3 5"
      />

      {ROWS.map((row, index) => {
        const y = rowY(index);
        const lit = row.focus ? ORANGE : IVORY;
        return (
          <g key={row.component}>
            <text className="font-mono" x={24} y={y - 2} fill={row.focus ? ORANGE : IVORY} fontSize={14}>
              {row.component}
            </text>
            <text className="font-mono" x={24} y={y + 16} fill={QUIET} fontSize={12}>
              {row.role}
            </text>
            {BANDS.map((band, column) =>
              row.bands.includes(band) ? (
                <circle key={band} cx={COLUMN_X[column]} cy={y} r={8} fill={lit} />
              ) : (
                <circle key={band} cx={COLUMN_X[column]} cy={y} r={2.5} fill={WARM} />
              ),
            )}
            <rect
              x={REGION_X}
              y={y - 14}
              width={60}
              height={26}
              rx={5}
              fill={GROUND}
              stroke={row.focus ? ORANGE : WARM}
              strokeWidth={1.5}
            />
            <text
              className="font-mono"
              x={REGION_X + 30}
              y={y + 4}
              textAnchor="middle"
              fill={row.focus ? ORANGE : IVORY}
              fontSize={12}
            >
              {row.region}
            </text>
          </g>
        );
      })}

    </svg>
  );
}
