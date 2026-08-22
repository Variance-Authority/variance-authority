import { GITHUB } from "../links";
import Timelines from "./Timelines";
import Verdict from "./Verdict";

/** The claim, and the run that stands behind it. */
export default function Hero() {
  return (
    <section className="relative pb-20 pt-16 sm:pt-20">
      {/* The sheaf runs behind the claim rather than in a strip above it:
          as its own band it cost a third of the first screen and pushed
          the buttons under the fold, and cropping a 220-tall viewBox into
          192px showed only its middle. Faded out before the prose so the
          lines never compete with a paragraph. */}
      {/* Only from `lg`, where the box is within a hand's width of the
          drawing's 3.6:1 and the fork lands in the open quarter beside the
          headline. A narrower box crops harder towards the middle, which
          walks the fork left until it strikes through the headline. */}
      <div className="pointer-events-none absolute -inset-x-6 -top-10 hidden h-[23rem] lg:block [mask-image:linear-gradient(to_bottom,black_62%,transparent_100%)]">
        {/* Two masks on two elements rather than one masked layer:
            `mask-composite` is the obvious way to intersect them and is
            the one part of CSS masking browsers still spell differently. */}
        <div className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent_2%,rgba(0,0,0,0.22)_34%,black_68%)]">
          <Timelines />
        </div>
      </div>
      <div className="rise relative">
        <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-quiet">
          <span className="text-green">open source</span>
          <span className="text-hairline">/</span>
          <span>MIT</span>
          <span className="text-hairline">/</span>
          <span>runs in your infrastructure</span>
        </p>
        <h1 className="max-w-4xl text-4xl font-bold leading-[1.06] tracking-tight text-ivory sm:text-6xl lg:text-[4.25rem]">
          Visual regression with{" "}
          <span className="bg-gradient-to-br from-orange to-fold bg-clip-text text-transparent">
            verifiable results.
          </span>
        </h1>
      </div>

      {/* The claim and the evidence for it, side by side. */}
      <div className="mt-10 grid items-start gap-10 lg:mt-12 lg:grid-cols-[1fr_1.06fr] lg:gap-12 [&>*]:min-w-0">
        <div className="rise" style={{ animationDelay: "0.1s" }}>
          <p className="leading-7 text-quiet sm:text-lg sm:leading-8">
            A padding token moves. Forty screenshots fail. The tool has found
            the visual change, but the next hour belongs to a reviewer. Variance
            Authority makes that investigation part of the run: it connects a
            changed region to the component that caused it and the{" "}
            <span className="font-mono text-[0.95em] text-ivory">file:line</span>{" "}
            where that component lives. The screenshot remains evidence; it stops
            being the whole answer.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#integrate"
              className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/25 ring-1 ring-inset ring-white/20 transition-transform hover:-translate-y-0.5"
            >
              Get started
            </a>
            <a
              href={GITHUB}
              className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:border-orange/60"
            >
              Star on GitHub
            </a>
          </div>

          {/* Below `lg` the sheaf gets a band of its own, in the gap
              between the ask and the evidence for it, where nothing is
              competing with it. A phone is still too narrow for the whole
              drawing, so it opens a window onto the fork instead. */}
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
