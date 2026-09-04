import ComparisonTable from "./ComparisonTable";

/**
 * The same table on the landing page, in the landing page's voice.
 *
 * The table is shared and every vendor cell in it is a checked quote. The
 * footnotes here are not: this page says "this project" where the document says
 * "Variance Authority", and compresses two paragraphs of it into a sentence.
 * Those are the site's own words and carry no marker. doc() means one thing on
 * both pages — verbatim in docs/comparison.md, checked by
 * `docs-claims.check.ts` — so a rewrite that wore it would be a claim about
 * sourcing the document does not support.
 */
const doc = (fragment: string) => fragment;

export default function LandingComparison() {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.16em] text-orange uppercase">
        the field, as this repository states it
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-quiet">
        Every vendor cell is quoted from the{" "}
        <a
          href="/reference/comparison"
          className="text-ivory underline decoration-hairline underline-offset-4 transition-colors hover:decoration-orange"
        >
          comparison document
        </a>
        , which links to each vendor&apos;s own published pages.
      </p>

      <ComparisonTable />

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
            . {doc("TurboSnap reads the static module graph")}. Wallaby.js holds
            the execution-side index, and takes it further than this project
            does. This project does not build that viewer. It ships the index
            underneath it: give coveringTests a source line or function and it
            returns the individual tests that executed it, nearest call stack
            first.{" "}
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
            Vendor facts come from the vendors&apos; published documentation.
            Hosted features and pricing change, so the linked pages are the
            authority for a buying decision.{" "}
            <a
              href="/reference/comparison"
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
