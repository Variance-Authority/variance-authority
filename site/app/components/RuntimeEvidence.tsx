import { GITHUB } from "../links";

const TESTS = [
  {
    name: "cart › survives an empty basket",
    trail: ["cart opens", "basket is empty", "empty state renders"],
    selected: true,
  },
  {
    name: "cart › applies a voucher",
    trail: ["cart opens", "voucher is valid", "priced state renders"],
    selected: false,
  },
] as const;

/** Runtime evidence as a selection answer, never a coverage score. */
export default function RuntimeEvidence() {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            changed path
          </p>
          <p className="mt-1 font-mono text-sm text-ivory">
            src/cart/empty.ts
          </p>
        </div>
        <span className="rounded-full border border-orange/60 bg-orange/[0.08] px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-orange uppercase">
          one test comes back
        </span>
      </div>

      <ol className="mt-5 space-y-3">
        {TESTS.map((test) => (
          <li
            key={test.name}
            className={`rounded-xl border p-4 ${
              test.selected
                ? "border-orange/60 bg-orange/[0.06]"
                : "border-hairline bg-deep"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className={`font-mono text-xs ${
                  test.selected ? "text-ivory" : "text-quiet"
                }`}
              >
                {test.name}
              </p>
              <span
                className={`font-mono text-[10px] tracking-[0.12em] uppercase ${
                  test.selected ? "text-orange" : "text-warm"
                }`}
              >
                {test.selected ? "selected" : "outside this change"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {test.trail.map((step, index) => (
                <span key={step} className="contents">
                  {index > 0 && (
                    <span aria-hidden="true" className="font-mono text-xs text-warm">
                      →
                    </span>
                  )}
                  <span
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                      test.selected && index === test.trail.length - 1
                        ? "border-orange/50 text-orange"
                        : "border-hairline text-quiet"
                    }`}
                  >
                    {step}
                  </span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-hairline pt-4">
        <p className="text-sm leading-6 text-quiet">
          The useful answer is not a percentage. It is the test that has been
          through the changed path before.
        </p>
        <a
          href={`${GITHUB}/tree/main/packages/sense#instrument-one-module`}
          className="mt-3 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
        >
          @variance-authority/sense/instrument →
        </a>
      </div>
    </div>
  );
}
