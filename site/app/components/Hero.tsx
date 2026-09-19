import Timelines from "./Timelines";
import AgentFlow from "./AgentFlow";
import IntegrationLogos from "./IntegrationLogos";

/** A first introduction, paired with a concrete agent workflow. */
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
          developer tools for you and your coding agent
        </p>
        <h1 className="max-w-4xl text-4xl font-bold leading-[1.06] tracking-tight text-ivory sm:text-6xl lg:text-[4.25rem]">
          <span className="block">Understand the code.</span>
          <span className="block">Investigate the behavior.</span>
          <span className="block bg-gradient-to-br from-orange to-fold bg-clip-text text-transparent">
            Check the work.
          </span>
        </h1>
      </div>

      {/* The claim and the evidence for it, side by side. */}
      <div className="mt-10 grid items-start gap-10 lg:mt-12 lg:grid-cols-[1fr_1.06fr] lg:gap-12 [&>*]:min-w-0">
        <div className="rise" style={{ animationDelay: "0.1s" }}>
          <p className="leading-7 text-quiet sm:text-lg sm:leading-8">
            Find the APIs your project already uses. Inspect a test while it
            runs. Trace a changed interface back to its source. Give your coding
            agent the tools to investigate, focus its tests, and check whether
            an edit achieved what you intended.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#questions"
              className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/25 ring-1 ring-inset ring-white/20 transition-transform hover:-translate-y-0.5"
            >
              See what you can do
            </a>
            <a
              href="#agents"
              className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:border-orange/60"
            >
              Equip your agent
            </a>
          </div>
          <p className="mt-6 max-w-lg text-sm leading-6 text-quiet">
            Open source · CLI, libraries, MCP, and agent skills · Runs in your
            infrastructure
          </p>

          {/* A phone opens a narrower window onto the fork. */}
          <div className="relative mt-10 h-28 sm:h-40 lg:hidden">
            <Timelines view="380 0 420 220" className="sm:hidden" />
            <Timelines className="hidden sm:block" />
          </div>
        </div>
        <div className="rise" style={{ animationDelay: "0.2s" }}>
          <AgentFlow />
        </div>
      </div>
      <IntegrationLogos />
    </section>
  );
}
