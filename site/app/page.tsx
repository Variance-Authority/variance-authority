import AgentFlow from "./components/AgentFlow";
import Attribution from "./components/Attribution";
import ClosingCall from "./components/ClosingCall";
import DiffReport from "./components/DiffReport";
import EvidenceSlices from "./components/EvidenceSlices";
import Flakes from "./components/Flakes";
import Hero from "./components/Hero";
import Integration from "./components/Integration";
import LandingComparison from "./components/LandingComparison";
import OperatingBargain from "./components/OperatingBargain";
import Reveal from "./components/Reveal";
import RuntimeEvidence from "./components/RuntimeEvidence";
import SectionHead from "./components/SectionHead";
import Since from "./components/Since";
import WithoutABaseline from "./components/WithoutABaseline";
import WhatTheRunKnew from "./components/WhatTheRunKnew";
import { GITHUB } from "./links";

export default function Page() {
  return (
    <div className="relative overflow-x-clip">
      <div
        aria-hidden="true"
        className="dot-grid absolute inset-x-0 -top-16 h-[42rem]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-40 right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-orange/[0.07] blur-3xl"
      />

      <main id="main-content" className="relative mx-auto max-w-6xl px-6">
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
              A pixel diff says that something changed. Variance Authority also
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
              label="deep react integration"
              title="React knows who rendered it—and what started the update."
            >
              This is not a component name guessed from the DOM. The page agent
              reads the live Fiber attached to each node: its author and owner
              chain, props, context and hook-cell digests, reconciliation keys,
              portals, remounts and pending Suspense boundaries. Source metadata
              carries the same trail back to the rendered file and line.
            </SectionHead>
            <div className="mt-12">
              <Attribution />
            </div>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
              A commit tap installed before React loads adds two different
              readings: which component render bodies ran, and which live
              instances initiated the update. If the tap arrives late, it
              refuses to claim coverage. The integration reads the
              application&apos;s React; it never imports or replaces it.{" "}
              <a
                href={`${GITHUB}/tree/main/packages/react`}
                className="text-orange underline decoration-hairline underline-offset-4 transition-colors hover:text-ivory"
              >
                Read the React contract →
              </a>
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
              repeats can share one decision. A state that carries evidence
              beyond the shared cause stays open and needs its own decision.
            </SectionHead>
            <div className="mt-12">
              <DiffReport />
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
              <article className="rounded-2xl border border-hairline bg-panel p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
                  local review
                </p>
                <h3 className="mt-3 text-lg font-semibold text-ivory">
                  No review service required.
                </h3>
                <p className="mt-3 text-sm leading-6 text-quiet">
                  The CLI writes an HTML page beside the report and its images.
                  Open it locally or upload the directory with the CI artifacts;
                  then promote the chosen candidates with{" "}
                  <span className="font-mono text-[0.95em] text-ivory">
                    variance accept
                  </span>
                  . Nothing needs an account or a running server.
                </p>
                <a
                  href={`${GITHUB}/tree/main/packages/cli#html-report`}
                  className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
                >
                  local report and acceptance →
                </a>
              </article>

              <article className="rounded-2xl border border-hairline bg-panel p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
                  shared review
                </p>
                <h3 className="mt-3 text-lg font-semibold text-ivory">
                  Tribunal runs in infrastructure you control.
                </h3>
                <p className="mt-3 text-sm leading-6 text-quiet">
                  Tribunal receives finished runs and holds their baselines,
                  history and per-subject decisions. Approval promotes the
                  candidate the run already uploaded; the service never renders
                  a replacement. It ships for a local Node process or a
                  Cloudflare Worker and is not a hosted Variance Authority
                  endpoint.
                </p>
                <a
                  href={`${GITHUB}/tree/main/packages/tribunal`}
                  className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
                >
                  self-host the Tribunal →
                </a>
              </article>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="flakes"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="04"
              label="flakes"
              title="A flake comes back with a name, not a retry."
            >
              Retries and tolerances trade a false alarm for a missed
              regression, at a rate nobody measures. A changed state is read a
              second time in the same world, then rendered again with the world
              rebuilt around it&mdash;two experiments, one variable each. What
              comes back is a component, and which of the readings changed:{" "}
              <span className="font-mono text-[0.95em] text-ivory">
                Clock (content)
              </span>
              , not <em>this test is flaky</em>.
            </SectionHead>
            <div className="mt-12">
              <Flakes />
            </div>
            <article className="mt-8 rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
                no two are alike
              </p>
              <h3 className="mt-3 text-lg font-semibold text-ivory">
                The run says what else in it could explain the change.
              </h3>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-quiet">
                Each changed component is checked against attribution rules in order:
                an edited file, an updated token, an edited caller, then a
                contradiction elsewhere in the suite. The first matching rule
                supplies the explanation. Otherwise, <em>unexplained</em>
                arrives beside the states where the same component with the same
                props held. That control group is the rest of the suite at this
                commit, and it was already collected.
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ivory">
                A retry deletes the report of a cause. A location deletes the
                cause.
              </p>
              <a
                href="/docs/flakiness"
                className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
              >
                who deals with each cause &rarr;
              </a>
            </article>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="without-a-baseline"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="05"
              label="what the run knew"
              title="An assertion is a question written before the run. The answer is one bit."
            >
              The execution knew more than that: which elements it addressed,
              which components rendered, which instance scheduled each render,
              which branch a service took while the page waited on it. All of it
              is reachable at a breakpoint, on a live page, with somebody
              watching&mdash;and none of those three hold in CI. So the record
              is taken while the page is alive and kept once it is gone. The
              test does not change.
            </SectionHead>
            <div className="mt-12">
              <WhatTheRunKnew />
            </div>
            <h3 className="mt-16 text-2xl font-bold tracking-tight text-ivory">
              Five instruments read the run in front of you. Not one opens a
              baseline.
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-quiet">
              What the test addressed, what the run is saying while it says it,
              at which step of a scenario two executions parted, where one set
              of inputs produced two results, and which path through the source
              each execution took. Each is installable on its own.
            </p>
            <div className="mt-8">
              <WithoutABaseline />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="intent"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="06"
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
            <div className="mt-8 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
              <article className="rounded-2xl border border-hairline bg-panel p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
                  MCP
                </p>
                <h3 className="mt-3 text-lg font-semibold text-ivory">
                  The evidence becomes something an agent can question.
                </h3>
                <p className="mt-3 text-sm leading-6 text-quiet">
                  MCP exposes visual reports, presentation findings,
                  source-to-test reach, test attention, scenarios and live-run
                  state as one set of tools. It reads evidence supplied by those
                  instruments; it never runs a test, rerenders a subject or
                  changes a baseline.
                </p>
                <a
                  href={`${GITHUB}/tree/main/packages/mcp`}
                  className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
                >
                  inspect the MCP surface →
                </a>
              </article>

              <article className="rounded-2xl border border-hairline bg-panel p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
                  events + vantage
                </p>
                <h3 className="mt-3 text-lg font-semibold text-ivory">
                  Ask a suite what it is doing before it stops.
                </h3>
                <p className="mt-3 text-sm leading-6 text-quiet">
                  Events announce decisions and bounded work from application or
                  service code. Vantage holds what each in-flight test heard,
                  from which realm, and which work started but never ended. MCP
                  makes that live state queryable. It needs no screenshot and
                  writes no lasting report; stop the watcher and it is gone.
                </p>
                <p className="mt-5 flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs">
                  <a
                    href={`${GITHUB}/tree/main/packages/event`}
                    className="text-orange transition-colors hover:text-ivory"
                  >
                    announcements →
                  </a>
                  <a
                    href={`${GITHUB}/tree/main/packages/vantage`}
                    className="text-orange transition-colors hover:text-ivory"
                  >
                    live-run view →
                  </a>
                </p>
              </article>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="selection"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="07"
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
                <div key={label} className="bg-deep p-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-orange">
                    {label}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-quiet">{body}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 grid max-w-4xl gap-6 sm:grid-cols-2">
              <p className="border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                A specifier scan misses one edge: a package that imports another
                package&apos;s <span className="text-ivory">built output</span>.
                Your design system usually sits behind that edge, so a change
                inside it looks like no change at all.{" "}
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
              n="08"
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
              <LandingComparison />
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
    </div>
  );
}
