import Answers from "./components/Answers";
import AgentFlow from "./components/AgentFlow";
import Attribution from "./components/Attribution";
import Bands from "./components/Bands";
import ClosingCall from "./components/ClosingCall";
import DiffReport from "./components/DiffReport";
import Eyebrow from "./components/Eyebrow";
import Hero from "./components/Hero";
import Integration from "./components/Integration";
import Lifecycle from "./components/Lifecycle";
import Packages from "./components/Packages";
import Reveal from "./components/Reveal";
import RuntimeEvidence from "./components/RuntimeEvidence";
import SectionHead from "./components/SectionHead";
import Since from "./components/Since";
import SiteFooter from "./components/SiteFooter";
import SiteHeader from "./components/SiteHeader";
import Variations from "./components/Variations";

export default function Page() {
  return (
    <div className="relative overflow-x-clip">
      {/* Hero backdrop: node grid + one warm glow, top of page only */}
      <div
        aria-hidden="true"
        className="dot-grid absolute inset-x-0 top-0 h-[42rem]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-40 right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-orange/[0.07] blur-3xl"
      />

      <SiteHeader />

      <main className="relative mx-auto max-w-6xl px-6">
        <Hero />

        {/* React attribution */}
        <Reveal>
          <section
            id="react"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="01"
              label="react"
              title="React was always a witness. Variance Authority asks it."
            >
              A screenshot shows where pixels changed. React already knows which
              component rendered the element. Variance Authority brings those two
              accounts together: the report connects the region to{" "}
              <span className="font-mono text-[0.95em] text-ivory">Title</span>,
              identifies what changed in the rendered document, and points to the
              source location that produced the element.
            </SectionHead>
            <div className="mt-12">
              <Attribution />
            </div>
          </section>
        </Reveal>

        {/* A/B arms and other related variants */}
        <Reveal>
          <section
            id="variations"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <div className="grid gap-10 lg:grid-cols-[2fr_3fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="02">A/B + variants</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  Each variant has a history. The difference between them has
                  one too.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  Your Storybook, route, or Playwright setup still creates the A
                  and B states. Each state keeps its own baseline, so regressions
                  are tracked over time. Variance Authority also compares related
                  states in the same run, so the report can tell whether both arms
                  moved together or the difference between them changed.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  The relationship can come from a consistent name or an explicit
                  tag. With a fixed axis order,{" "}
                  <span className="font-mono text-[0.95em] text-ivory">
                    checkout-dark-narrow
                  </span>{" "}
                  varies{" "}
                  <span className="font-mono text-[0.95em]">checkout-dark</span>,
                  which varies{" "}
                  <span className="font-mono text-[0.95em]">checkout</span>.
                  Each comparison covers one axis.
                </p>
                <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                  English fixes adjective order: a great green dragon cannot be
                  called a green great dragon, so one dragon has one name. You
                  choose the attributes, their values, and their order—scheme
                  before viewport before flag, or any grammar that fits your
                  suite. Variance Authority uses that grammar to take each state
                  name apart. Keep it consistent and every state has one name and
                  one parent. That is the great green dragon rule.
                </p>
              </div>
              <Variations />
            </div>
          </section>
        </Reveal>

        {/* The run */}
        <Reveal>
          <section
            id="run"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="03"
              label="performance"
              title="Repeat only the work that changed."
            >
              A run is a chain of answers, not one indivisible job. The source
              scan, captured document, and painted result can be reused
              independently. When an answer is still true, the run picks it up
              and continues from the first question that changed. A matching
              document can settle without paint, and the same document under
              the same renderer can reuse the exact image.
            </SectionHead>
            <div className="mt-12">
              <Lifecycle />
            </div>
            <p className="mt-6 font-mono text-xs text-warm">
              example run · 39 of 40 UI states stop before another browser render
            </p>
          </section>
        </Reveal>

        {/* Sensitivity */}
        <Reveal>
          <section
            id="sensitivity"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <div className="grid gap-10 lg:grid-cols-[2fr_3fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="04">sensitivity</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  Decide what each test should care about.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  A component test should catch a colour-token change. A route
                  test usually needs to know that the page still assembles and
                  remains accessible. Sensitivity levels let the same comparison
                  serve both without a global pixel threshold.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Accessibility stays checked at every level. Layout, authored
                  styles, text, and pixels can be included or excluded by
                  category, so ignoring antialiasing does not hide a small but
                  real layout change.
                </p>
              </div>
              <Bands />
            </div>
          </section>
        </Reveal>

        {/* Sense */}
        <Reveal>
          <section
            id="selection"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <div className="grid gap-10 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="05">selection</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  Run only the UI a change can reach.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  <span className="font-mono text-[0.95em] text-ivory">
                    --since
                  </span>{" "}
                  follows source imports from a changed file to the React
                  components that depend on it, then selects the UI states that
                  rendered those components. A token file may not declare a
                  component itself, and neither may a theme provider, shared
                  helper, or icon.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  For example,{" "}
                  <span className="font-mono text-[0.95em]">tokens.css</span>{" "}
                  reaches{" "}
                  <span className="font-mono text-[0.95em]">Button.tsx</span>{" "}
                  through its stylesheet. If the source cannot be read, selection
                  widens instead of guessing.
                </p>
                <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                  Missing a dependency would skip a test that should have run.
                  Uncertainty therefore selects more, never less.
                </p>
              </div>
              <Since />
            </div>
          </section>
        </Reveal>

        {/* Runtime evidence */}
        <Reveal>
          <section
            id="runtime"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <div className="grid gap-10 lg:grid-cols-[2fr_3fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="06">runtime evidence</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  Let each test leave a trail for the next run.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  Source reach tells you which UI a change could affect. A run
                  can answer the other half: which tests actually entered the
                  changed path. Variance Authority keeps that evidence with the
                  test, so the next edit starts from observed behaviour instead
                  of every import.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Change the empty-cart path and the tests that used it come
                  back. Tests that stayed on the priced-cart path do not. Static
                  reach remains the safety net for new paths and anything the
                  run could not observe.
                </p>
                <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                  This is coverage used as a question, not a score: which test
                  has been here before?
                </p>
              </div>
              <RuntimeEvidence />
            </div>
          </section>
        </Reveal>

        {/* The report — what a reviewer actually opens */}
        <Reveal>
          <section
            id="report"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="07"
              label="the report"
              title="Compare the images without losing the cause."
            >
              A small shift is easy to miss in three images placed side by side.
              The HTML report starts with changed regions and the component that
              owns each one, then offers wipe, blend, blink, and region views.
              For React captures with source information, the same row also
              points to the line that produced the element.
            </SectionHead>
            <div className="mt-12">
              <DiffReport />
            </div>
            <p className="mt-6 font-mono text-xs text-warm">
              one self-contained report, ready to open from a CI artifact
            </p>
          </section>
        </Reveal>

        {/* The report-backed agent review loop. */}
        <Reveal>
          <section
            id="agents"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <div className="grid gap-10 lg:grid-cols-[2fr_3fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="08">agentic review</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  Give the agent evidence—and the tools to finish.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  The agent declares what it intends to change before it reads
                  the result. After the run, it can group repeated movement into
                  one decision, trace the cause through HTML and React to source,
                  and check what was delivered, exceeded, or never happened.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Before any baseline changes, the same evidence previews the
                  exact safe acceptance and names what must stay in review. The
                  agent edits and reruns; the reviewer sees the same account.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Some of what an agent needs has no baseline behind it.
                  Presentation senses the relationships inside one live page —
                  spacing, alignment, prominence, repetition. Scenarios record
                  Arrange, Act, Assert as a state machine and assess the
                  variance across a transition. Both answer while the agent
                  works, with nothing to approve.
                </p>
                <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                  Agent-ready is not a report the agent can read. It is a review
                  loop the agent can complete.
                </p>
              </div>
              <AgentFlow />
            </div>
          </section>
        </Reveal>

        {/* Straight answers */}
        <Reveal>
          <section
            id="position"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="09"
              label="questions"
              title="What to ask before adopting it."
            >
              Visual testing tends to fail in familiar ways. Here is how
              Variance Authority handles hosting, instability, missing evidence,
              pixel thresholds, CI, and operating cost.
            </SectionHead>
            <div className="mt-12">
              <Answers />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <Packages />
        </Reveal>

        <Reveal>
          <Integration />
        </Reveal>

        <Reveal>
          <ClosingCall />
        </Reveal>

        <SiteFooter />
      </main>
    </div>
  );
}
