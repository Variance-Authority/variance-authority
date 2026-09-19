/**
 * The competitor table, with a gate instead of a promise.
 *
 * Every cell here is wrapped in the doc marker, and the marker means exactly one
 * thing: this string is a verbatim fragment of docs/comparison.md — the document
 * that cites each vendor's published pages and states what each does better than
 * this project. `docs-claims.check.ts` reads every `*Comparison*.tsx` in this
 * directory and fails `yarn check` when a marked fragment is not in that
 * document, so no page can quietly out-claim the source it compares against.
 * Fairness here is checked, not intended.
 *
 * The rows live here rather than in each page because a second copy of a checked
 * table is a second table to drift: the landing copy did drift, into five vendor
 * cells the document never wrote, while the routed copy stayed correct. There is
 * one table now, and the pages differ only in the words around it.
 */
const doc = (fragment: string) => fragment;

const VENDORS = ["Percy", "Chromatic", "Argos", "Applitools"] as const;

const ROWS = [
  {
    q: "where pixels are made",
    cells: [
      doc("Percy cloud, or the Automate browser"),
      doc("Capture Cloud"),
      doc("Caller-owned browser"),
      doc("Caller browser or Ultrafast Grid"),
      doc("Caller-owned browser, local renderer, or a renderer you host"),
    ],
  },
  {
    q: "who owns review",
    cells: [
      doc("Hosted dashboard and approval workflow"),
      doc("Hosted UI Test and UI Review"),
      doc("Hosted test review, comments, and flake history"),
      doc("Eyes Test Manager"),
      doc(
        "`tribunal`, a review service you deploy — builds, docket, region overlays, recorded decisions",
      ),
    ],
  },
  {
    q: "browser coverage",
    cells: [
      doc("Managed desktop and mobile coverage"),
      doc("Managed browser and mode matrix"),
      doc("Whatever the caller's capture suite runs"),
      doc("Managed grid plus mobile products"),
      doc("Whatever the caller's capture suite runs"),
    ],
  },
  {
    q: "a diff points to",
    cells: [
      doc("DOM and CSS root-cause aids"),
      doc("Story identity and dependency tracing"),
      doc("Spec and story metadata"),
      doc("DOM and CSS root-cause aids"),
      doc(
        "Pixel region → component → file:line, when the capture supplies matching provenance",
      ),
    ],
  },
  {
    q: "compared against",
    cells: [
      doc("The approved baseline"),
      doc("The approved baseline"),
      doc("The approved baseline"),
      doc("The approved baseline"),
      doc(
        "The baseline. Also, within a single run: two related states, compared for the gap between them; and one input rendered twice, compared for the point where the two renderings diverge",
      ),
    ],
  },
  {
    q: "change-driven selection",
    cells: [
      doc("The states your test code calls `percySnapshot` on"),
      doc(
        "TurboSnap uses the module graph to avoid snapshots a change cannot reach",
      ),
      doc("The screenshots your suite takes"),
      doc("The checkpoints your SDK calls make"),
      doc(
        "`--since` skips a subject when its baseline lists none of the components the change reached — stories, routes and Playwright subjects alike. Instrumented test runs also select test files by what they executed",
      ),
    ],
  },
  {
    q: "the meter counts",
    cells: [
      doc("screenshots"),
      doc("snapshots with product-specific multipliers"),
      doc("screenshots"),
      doc("a Page independently of browser and device repetitions"),
      doc("no vendor meter"),
    ],
  },
  {
    q: "who operates it",
    cells: [
      doc("Vendor"),
      doc("Vendor"),
      doc(
        "Vendor, with an open-source self-host option outside the supported service contract",
      ),
      doc("Vendor or contracted on-premise deployment"),
      doc("Adopter"),
    ],
  },
  {
    q: "choose it when",
    cells: [
      doc(
        "managed browser coverage, organization-wide review, or a wide SDK catalog",
      ),
      doc(
        "review should be a product — Storybook inventory, E2E archives, or both — and non-engineer review, branch semantics, and managed stability matter more to you than self-operation",
      ),
      doc(
        "the suite should own pixels but the vendor should own review and history",
      ),
      doc(
        "managed cross-browser and mobile coverage, perceptual match levels, enterprise workflow, or an on-premise commercial deployment",
      ),
      doc(
        "a changed screenshot should arrive as one cause with its evidence and be settled in one decision",
      ),
    ],
  },
] as const;

export default function ComparisonTable() {
  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-panel">
      <table className="w-full min-w-[64rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline">
            <th className="w-36 p-4 align-bottom font-mono text-[10px] font-normal tracking-[0.14em] text-warm uppercase" />
            {VENDORS.map((vendor) => (
              <th
                key={vendor}
                className="p-4 align-bottom text-sm font-semibold text-ivory"
              >
                {vendor}
              </th>
            ))}
            <th className="bg-orange/[0.04] p-4 align-bottom text-sm font-semibold text-orange">
              Variance Authority
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr
              key={row.q}
              className="border-b border-hairline align-top last:border-b-0"
            >
              <th
                scope="row"
                className="w-36 p-4 text-left font-mono text-[10px] font-normal tracking-[0.14em] text-warm uppercase"
              >
                {row.q}
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={VENDORS[index] ?? "variance-authority"}
                  className={`p-4 text-xs leading-5 first-letter:uppercase ${
                    index === row.cells.length - 1
                      ? "bg-orange/[0.04] text-ivory"
                      : "text-quiet"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
