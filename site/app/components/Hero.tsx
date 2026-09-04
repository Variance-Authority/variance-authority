import Timelines from "./Timelines";
import Verdict from "./Verdict";

/** The claim, and the run that stands behind it. */
export default function Hero() {
  return (
    <section className="relative pb-20 pt-16 sm:pt-20">
      {/* Wide screens can keep the fork clear of the headline. Narrow screens
          render the drawing below the call to action instead. */}
      <div className="pointer-events-none absolute -inset-x-6 -top-10 hidden h-[23rem] lg:block [mask-image:linear-gradient(to_bottom,black_62%,transparent_100%)]">
        {/* Separate elements avoid the browser-specific `mask-composite`. */}
        <div className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent_2%,rgba(0,0,0,0.22)_34%,black_68%)]">
          <Timelines />
        </div>
      </div>
      <div className="rise relative">
        <p className="mb-6 font-mono text-xs uppercase tracking-[0.18em] text-orange">
          composable evidence tools
        </p>
        <h1 className="max-w-4xl text-4xl font-bold leading-[1.06] tracking-tight text-ivory sm:text-6xl lg:text-[4.25rem]">
          <span className="block">Many screenshots.</span>
          <span className="block bg-gradient-to-br from-orange to-fold bg-clip-text text-transparent">
            One review decision.
          </span>
        </h1>
      </div>

      {/* The claim and the evidence for it, side by side. */}
      <div className="mt-10 grid items-start gap-10 lg:mt-12 lg:grid-cols-[1fr_1.06fr] lg:gap-12 [&>*]:min-w-0">
        <div className="rise" style={{ animationDelay: "0.1s" }}>
          <p className="leading-7 text-quiet sm:text-lg sm:leading-8">
            Variance Authority is a set of composable evidence tools for
            software that changes. Visual review is one composition: it connects
            a changed pixel to the document and accessibility evidence behind
            it, to the React component that owns it and the inputs that changed,
            and to the source that rendered it. States that changed the same way
            are reviewed as one decision. A state with extra or missing evidence
            stays open.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#review"
              className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/25 ring-1 ring-inset ring-white/20 transition-transform hover:-translate-y-0.5"
            >
              See the review
            </a>
            <a
              href="#integrate"
              className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:border-orange/60"
            >
              Choose an integration
            </a>
          </div>

          {/* A phone opens a narrower window onto the fork. */}
          <div className="relative mt-10 h-28 sm:h-40 lg:hidden">
            <Timelines view="380 0 420 220" className="sm:hidden" />
            <Timelines className="hidden sm:block" />
          </div>
        </div>
        <div className="rise" style={{ animationDelay: "0.2s" }}>
          <Verdict />
        </div>
      </div>
    </section>
  );
}
