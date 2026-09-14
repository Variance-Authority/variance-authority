import ClosingCall from "./components/ClosingCall";
import EvidenceSlices from "./components/EvidenceSlices";
import Hero from "./components/Hero";
import Integration from "./components/Integration";
import OperatingBargain from "./components/OperatingBargain";
import QuestionMap from "./components/QuestionMap";
import Reveal from "./components/Reveal";
import SectionHead from "./components/SectionHead";
import { EXAMPLE_BUILD } from "./links";

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
          <QuestionMap />
        </Reveal>

        <Reveal>
          <section
            id="visual-review"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="01"
              label="one composition"
              title="A changed screen becomes a cause you can inspect."
            >
              Visual review connects independent UI readings to runtime
              ownership and source. A repeated cause is decided once; a state
              with additional or missing evidence remains open.
            </SectionHead>

            <div className="mt-12">
              <EvidenceSlices />
            </div>

            <div className="mt-8 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3">
              {[
                [
                  "read",
                  "Text, accessibility, layout, authored styles, and pixels remain independent readings.",
                ],
                [
                  "attribute",
                  "A changed region resolves through React ownership and inputs to source when the capture supplies that trail.",
                ],
                [
                  "decide",
                  "Repeated causes share one decision; states with additional or missing evidence stay open.",
                ],
              ].map(([label, body]) => (
                <div key={label} className="bg-deep p-5">
                  <p className="font-mono text-[10px] tracking-widest text-orange uppercase">
                    {label}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-quiet">{body}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 flex max-w-3xl flex-wrap gap-x-5 gap-y-2 font-mono text-xs">
              <a
                href={EXAMPLE_BUILD}
                className="text-orange transition-colors hover:text-ivory"
              >
                open the example build →
              </a>
              <a
                href="/docs/attribution"
                className="text-orange transition-colors hover:text-ivory"
              >
                trace a pixel to source →
              </a>
              <a
                href="/docs/composition"
                className="text-orange transition-colors hover:text-ivory"
              >
                group repeated changes →
              </a>
            </p>
          </section>
        </Reveal>

        <Reveal>
          <section
            id="selection"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="02"
              label="selection + reuse"
              title="Run the states and tests the change actually reached."
            >
              Static source relations establish what an edit could affect.
              Recorded execution narrows that answer to UI states and test
              files that entered the changed code. Uncertainty always selects
              more work, never less.
            </SectionHead>
            <div className="mt-10 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3">
              {[
                [
                  "could reach",
                  "Source relations carry a changed file through its importers to affected components.",
                ],
                [
                  "did execute",
                  "Earlier runs record the UI states and test files that entered the changed source regions.",
                ],
                [
                  "can reuse",
                  "Matching documents avoid a repaint; matching renderer inputs reuse an exact cached raster.",
                ],
              ].map(([label, body]) => (
                <div key={label} className="bg-deep p-5">
                  <p className="font-mono text-[10px] tracking-widest text-orange uppercase">
                    {label}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-quiet">{body}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
              The graph and execution record remain separate. Missing or
              unreadable evidence widens the run instead of becoming permission
              to skip. {" "}
              <a
                href="/docs/selecting"
                className="text-orange transition-colors hover:text-ivory"
              >
                Read the selection contract →
              </a>
            </p>
          </section>
        </Reveal>

        <Reveal>
          <Integration />
        </Reveal>

        <Reveal>
          <section
            id="fit"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="04"
              label="the bargain"
              title="Control the evidence stack. Own the cost of operating it."
            >
              Variance Authority is open source and runs in infrastructure you
              control. That buys composability and removes a vendor meter; it
              also leaves browser capacity, storage, deployment, and operation
              with the adopter.
            </SectionHead>
            <div className="mt-12">
              <OperatingBargain />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <ClosingCall />
        </Reveal>
      </main>
    </div>
  );
}
