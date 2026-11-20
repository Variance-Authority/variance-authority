import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROWS } from "./ChangeKinds";
import { STEPS } from "./RegionToLine";
import { LABELS } from "./ShiftOrChange";

/**
 * The three visual-review figures draw one committed run. Their labels are
 * typed into the components, so each is checked here against that run's
 * `variance ask describe` answer, the way the pages that quote it are checked
 * in the example's own test.
 */
const report = readFileSync(
  new URL("../../../examples/visual-review-case/artifacts/report.txt", import.meta.url),
  "utf8",
);
/** The report's lines with each run of spaces as one, which is how a figure sets them. */
const lines = report.split("\n").map((line) => line.trim().replace(/ +/g, " "));

const componentLine = (entry: { role: string; component: string; bands: readonly string[] }) =>
  `${entry.role} ${entry.component} — ${entry.bands.join(", ")}`;

describe("the visual-review figures", () => {
  it("label each component of the card as the report does", () => {
    for (const label of LABELS) expect(lines).toContain(componentLine(label));
  });

  it("grid each component's bands as the report does", () => {
    for (const row of ROWS) expect(lines).toContain(componentLine(row));
  });

  it("unfold a region exactly as the report lists it", () => {
    const [region, component, ...rest] = STEPS.map((step) => step.text);
    const declared = rest.pop();
    const head = lines.indexOf(`${region} — ${component}`);

    expect(head).toBeGreaterThan(-1);
    expect(lines[head + 1]).toBe(`in ${rest.join(" → ")}`);
    expect(lines[head + 2]).toBe(declared);
  });
});
