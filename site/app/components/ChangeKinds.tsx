/**
 * The bands each component of examples/visual-review-case changed in, as the
 * `components:` rows of its committed `variance ask describe` answer list
 * them: the button in `token` alone, the name in `a11y`, `geometry` and
 * `content`, the collateral price in `geometry` alone. The columns are the four
 * bands a component changes in; `texture` is raster residue counted on a region,
 * never on a component, so it has none.
 *
 * Ivory marks a band that changed, orange the button: a change in one style
 * value alone, per docs/visual-guidelines.md.
 */

const IVORY = "#f3f4f6";
const ORANGE = "#ff4a19";
const WARM = "#756d67";
const QUIET = "#8f8580";

const BANDS = ["a11y", "geometry", "token", "content"] as const;
const COLUMN_X = [230, 320, 410, 500];

interface Row {
  component: string;
  role: "cause" | "collateral";
  bands: readonly (typeof BANDS)[number][];
  focus?: boolean;
}

/** Pinned to examples/visual-review-case/artifacts/report.txt by its test. */
export const ROWS: readonly Row[] = [
  { component: "ChooseButton", role: "cause", bands: ["token"], focus: true },
  { component: "PlanName", role: "cause", bands: ["a11y", "geometry", "content"] },
  { component: "Price", role: "collateral", bands: ["geometry"] },
];

const rowY = (index: number) => 132 + index * 70;

export default function ChangeKinds() {
  return (
    <svg
      viewBox="0 0 560 360"
      className="block h-auto w-full"
      role="img"
      aria-label="A grid of three components against the four bands a component changes in: a11y, geometry, token and content. ChooseButton, a cause, changed in token alone. PlanName, a cause, changed in a11y, geometry and content. Price, collateral, changed in geometry alone."
    >
      {BANDS.map((band, column) => (
        <text
          key={band}
          className="font-mono"
          x={COLUMN_X[column]}
          y={70}
          textAnchor="middle"
          fill={IVORY}
          fontSize={12}
        >
          {band}
        </text>
      ))}
      <line x1={24} y1={88} x2={536} y2={88} stroke={WARM} strokeWidth={1} />

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
          </g>
        );
      })}

    </svg>
  );
}
