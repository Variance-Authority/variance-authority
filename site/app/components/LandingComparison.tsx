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
            {doc("Percy")} captures{" "}
            {doc("The states your test code calls `percySnapshot` on")}, and{" "}
            {doc("Argos")} {doc("The screenshots your suite takes")}.{" "}
            {doc(
              "The capture row divides on one axis: what a change imports versus what its tests executed",
            )}
            . {doc("TurboSnap reads the static module graph")}. Wallaby.js keeps
            an execution index of this kind for its own editor tooling. This
            project ships the index underneath:{" "}
            {doc(
              "given a source line or function, it returns the individual tests that executed it, nearest call stack first",
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
