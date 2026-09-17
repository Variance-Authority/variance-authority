import ComparisonTable from "./ComparisonTable";

/**
 * The comparison table as the reference page frames it: pick by boundary, then
 * read the sourced document.
 *
 * The table itself is shared — every vendor cell is a checked quote, and the
 * rows live in ComparisonTable. What is here is the framing around it and the
 * footnotes, which quote the same document and carry the same marker: doc()
 * means this string appears verbatim in docs/comparison.md, and
 * `docs-claims.check.ts` fails `yarn check` when it stops being true.
 */
const doc = (fragment: string) => fragment;

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
        </a>{" "}
        links each commercial claim to the vendor&apos;s published material.
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
            . {doc("TurboSnap reads the static module graph")}.{" "}
            {doc(
              "Wallaby.js holds the execution-side index, and takes it further than Variance Authority",
            )}
            .{" "}
            {doc(
              "Variance Authority exposes the underlying index through a function called `coveringTests`, not a time-travel viewer",
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
            {doc("Vendor documentation is authoritative for vendor behaviour")}.{" "}
            {doc(
              "Verify pricing and hosted-service features there before buying",
            )}
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
