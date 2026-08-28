import AgentFlow from "./components/AgentFlow";
import Attribution from "./components/Attribution";
import ClosingCall from "./components/ClosingCall";
import DiffReport from "./components/DiffReport";
import EvidenceSlices from "./components/EvidenceSlices";
import Hero from "./components/Hero";
import Integration from "./components/Integration";
import Comparison from "./components/Comparison";
import OperatingBargain from "./components/OperatingBargain";
import Reveal from "./components/Reveal";
import RuntimeEvidence from "./components/RuntimeEvidence";
import SectionHead from "./components/SectionHead";
import Since from "./components/Since";
import SiteFooter from "./components/SiteFooter";
import SiteHeader from "./components/SiteHeader";

export default function Page() {
  return (
    <div className="relative overflow-x-clip">
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

        <Reveal>
          <section
            id="evidence"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="01"
              label="five readings"
              title="One UI. Several independent readings."
            >
              A pixel diff says that something moved. Variance Authority also
              reads the text, the accessibility tree, the layout, and the
              authored styles. Whatever pixels still differ after those four are
              the fifth reading. The readings stay separate, so a reviewer can
              dismiss paint noise and keep a text, layout, or accessibility
              change open.
            </SectionHead>
            <div className="mt-12">
              <EvidenceSlices />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="react"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="02"
              label="react trail"
              title="React knows who rendered it—and what the component was holding."
            >
              The next question after "what changed" is which component owns
              the change, and which of its inputs moved. The capture walks the
              React tree alongside the DOM. Each changed node carries its owning
              component, and says whether a prop, a context value, or local
              state changed with it. If the build emits source metadata, the
              same row points at the file and line that rendered the element.
            </SectionHead>
            <div className="mt-12">
              <Attribution />
            </div>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
              Every claim names its source. Inputs come from the running tree;
              file locations come from the build. When a source is missing, the
              report shows a gap rather than a guess.
            </p>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="review"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="03"
              label="the review"
              title="Settle the cause once, not once per screenshot."
            >
              When the same component-level change appears across routes,
              stories, or browser cases, the report groups those states. Exact
              repeats can share one decision. A state that carries evidence beyond the
              shared cause stays open and needs its own decision.
            </SectionHead>
            <div className="mt-12">
              <DiffReport />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="intent"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="04"
              label="agent intent"
              title="Connect a cause to its effect, at every layer."
            >
              An agent declares the component and UI states it means to change.
              The run compares that declaration against what the capture shows:
              delivered, undelivered, overreached, unclaimed. Over MCP the same
              agent can then walk the chain in either direction—a region to a
              component, a component to its inputs, a source line to the tests
              that entered it—and read the evidence itself rather than a summary
              of it.
            </SectionHead>
            <div className="mt-12">
              <AgentFlow />
            </div>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
              This interface only produces evidence. It shows the boundary of
              a proposed change. Execution and acceptance stay with the tools
              that own them.
            </p>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="selection"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="05"
              label="selection + reuse"
              title="Run the UI states the change actually reached."
            >
              A static scan of the source finds every component a changed file
              can affect. Runtime evidence from earlier runs then narrows that
              set to the UI states and test files that actually executed the
              changed code. When reach cannot be determined, the run selects
              more work rather than less.
            </SectionHead>
            <div className="mt-12 grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
              <Since />
              <RuntimeEvidence />
            </div>
            <div className="mt-8 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3">
              {[
                [
                  "document match",
                  "A state whose captured document still matches settles without a repaint.",
                ],
                [
                  "renderer match",
                  "The same document under the same renderer can reuse the exact cached raster.",
                ],
                [
                  "unknown reach",
                  "When evidence is unreadable or incomplete, the run selects more work or reports no conclusion.",
                ],
              ].map(([label, body]) => (
                <div key={label} className="bg-ink p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-orange">
                    {label}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-quiet">{body}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 grid max-w-4xl gap-6 sm:grid-cols-2">
              <p className="border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                A specifier scan misses one edge: a package that imports
                another package&apos;s{" "}
                <span className="text-ivory">built output</span>. Your design
                system usually sits behind that edge, so a change inside it
                looks like no change at all.{" "}
                <span className="font-mono text-[0.95em]">nx</span> and{" "}
                <span className="font-mono text-[0.95em]">turbo</span> see it.
                Point at whichever you already run. Its affected-project list
                feeds the scan as more changed input, and the run takes the
                union of both answers. It never becomes the selection itself,
                because one project holds hundreds of subjects.
              </p>
              <p className="border-l-2 border-hairline pl-4 text-sm leading-6 text-quiet">
                The second axis is what a change{" "}
                <span className="text-ivory">executed</span>.{" "}
                <a
                  href="https://wallabyjs.com/docs/features/test-stories/"
                  className="text-ivory underline decoration-hairline underline-offset-4 transition-colors hover:decoration-orange"
                >
                  Wallaby&apos;s Test Story Viewer
                </a>{" "}
                has taken that furthest: it shows one test&apos;s entire
                execution history in a single view, steppable and inspectable.
                This project collects the same kind of story for every render,
                and for every component that took part in it.
              </p>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="fit"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="06"
              label="the bargain"
              title="Control the evidence stack. Own the cost of operating it."
            >
              Here is the trade in both directions. What owning the stack buys
              you, when a managed product is the better answer, and where the
              field is ahead of this project.
            </SectionHead>
            <div className="mt-12">
              <OperatingBargain />
            </div>
            <div className="mt-14">
              <Comparison />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <Integration />
        </Reveal>
        <Reveal>
          <ClosingCall />
        </Reveal>
      </main>

      <SiteFooter />
    </div>
  );
}
