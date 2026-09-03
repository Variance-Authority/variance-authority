/**
 * The competitor table, with a gate instead of a promise.
 *
 * Every cell wrapped in the doc marker is a verbatim fragment of docs/comparison.md —
 * the document that cites each vendor's published pages and states what each
 * does better than this project. The claims check fails `yarn check` when a cell
 * drifts from that document, so this page cannot quietly out-claim the source
 * it compares against. Fairness here is checked, not intended.
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
      doc("Caller-owned browser, local renderer, or operator-owned remote renderer"),
    ],
  },
  {
    q: "who owns review",
    cells: [
      doc("Hosted dashboard and approval workflow"),
      doc("Hosted UI Test and UI Review"),
      doc("Hosted test review, comments, and flake history"),
      doc("Eyes Test Manager"),
      {
        text: doc(
          "Self-hosted tribunal — builds, docket, region overlays, recorded decisions",
        ),
      },
    ],
  },
  {
    q: "browser coverage",
    cells: [
      doc("Managed desktop/mobile coverage"),
      doc("Managed browser and mode matrix"),
      doc("Whatever the caller's capture suite runs"),
      doc("Managed grid plus mobile products"),
      doc("Whatever the caller's capture suite runs"),
    ],
  },
  {
    q: "a diff points to",
    cells: [
      doc("DOM/CSS root-cause aids"),
      doc("Story identity and dependency tracing"),
      doc("Spec/story metadata"),
      doc("DOM/CSS root-cause aids"),
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
      doc("No documented equivalent"),
      doc("TurboSnap uses the module graph to avoid snapshots a change cannot reach"),
      doc("No documented equivalent"),
      doc("No documented equivalent"),
      doc(
        "--since skips a subject when its baseline lists none of the components the change reached. This applies to stories, routes, and Playwright subjects alike. Instrumented test runs also select test files by what they executed",
      ),
    ],
  },
  {
    q: "the meter counts",
    cells: [
      doc("screenshots"),
      doc("snapshots with product-specific multipliers"),
      doc("screenshots"),
      doc("a Page independently of browser/device repetitions"),
      doc("no vendor meter"),
    ],
  },
  {
    q: "who operates it",
    cells: [
      doc("Vendor"),
      doc("Vendor"),
      doc("Vendor, with an open-source self-host option outside the supported service contract"),
      doc("Vendor or contracted on-premise deployment"),
      doc("Adopter"),
    ],
  },
  {
    q: "choose it when",
    cells: [
      doc("managed browser coverage, organization-wide review, or a wide SDK catalog"),
      doc(
        "Storybook is your canonical UI inventory, and non-engineer review, branch semantics, and managed stability matter more to you than self-operation",
      ),
      doc("the suite should own pixels but the vendor should own review and history"),
      doc("managed cross-browser/mobile coverage, perceptual match levels, enterprise workflow, or an on-premise commercial deployment"),
      doc(
        "a changed screenshot should arrive as one cause with its evidence, and be settled in one decision",
      ),
    ],
  },
] as const;

export default function Comparison() {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.16em] text-orange uppercase">
        choose by operating boundary
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-quiet">
        Start with where pixels are made, who owns review, and who operates the
        system. The{" "}
        <a
          href="#1-the-dimensions-a-buyer-actually-decides-on"
          className="text-ivory underline decoration-hairline underline-offset-4 transition-colors hover:decoration-orange"
        >
          detailed comparison
        </a>
        {" "}links each commercial claim to the vendor&apos;s published material.
      </p>

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
                    {typeof cell === "string" ? (
                      cell
                    ) : (
                      cell.text
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-5 max-w-4xl space-y-4">
        <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-5">
          <dt className="font-mono text-[10px] tracking-[0.14em] text-warm uppercase">
            the meter counts
          </dt>
          <dd className="text-xs leading-5 text-quiet">
            There is no per-shot bill. That is not the same as free: compute,
            storage, browsers, and operation are the price of the last column.
          </dd>
        </div>

        <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-5">
          <dt className="font-mono text-[10px] tracking-[0.14em] text-warm uppercase">
            change-driven selection
          </dt>
          <dd className="text-xs leading-5 text-quiet">
            {doc("Percy")} and {doc("Argos")}{" "}
            {doc(
              "leave selection to you: you shard the suite yourself. That is a deliberate design choice, not a missing feature",
            )}
            .{" "}
            {doc(
              "The selection row divides on one axis: what a change imports versus what its tests executed",
            )}
            . {doc("TurboSnap reads the static module graph")}.{" "}
            {doc(
              "Wallaby.js holds the execution-side index, and takes it further than Variance Authority",
            )}
            .{" "}
            {doc(
              "Variance Authority exposes the underlying index through coveringTests, not a time-travel viewer",
            )}
            .{" "}
            {doc(
              "Given a source line or function, it returns the individual tests that executed it, nearest call stack first, from an execution index supplied by any collector",
            )}
            .{" "}
            {doc(
              "The shipped integration records one entry per test file and stores no call-stack depth, so per-test answers require a collector that already records them",
            )}
            .
          </dd>
        </div>

        <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-5">
          <dt className="font-mono text-[10px] tracking-[0.14em] text-warm uppercase">
            sources
          </dt>
          <dd className="text-xs leading-5 text-quiet">
            {doc("Vendor documentation is authoritative for vendor behaviour")}
            .{" "}
            {doc("Verify pricing and hosted-service features there before buying")}
            .{" "}
            <a
              href="#1-the-dimensions-a-buyer-actually-decides-on"
              className="font-mono text-orange transition-colors hover:text-ivory"
            >
              Full comparison, with sources →
            </a>
          </dd>
        </div>
      </dl>
    </div>
  );
}
