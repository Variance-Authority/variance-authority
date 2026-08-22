import Answers from "./components/Answers";
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

        {/* The chain — the magic */}
        <Reveal>
          <section className="border-t border-hairline py-20">
            <SectionHead
              n="01"
              label="attribution"
              title="A pixel is a poor witness. Follow it to the line that wrote it."
            >
              A PNG knows colours and coordinates. It does not know that the
              changed pixels came from{" "}
              <span className="font-mono text-[0.95em] text-ivory">Title</span>,
              or that only its paint changed while its structure held. So the
              run compares the rendered document, and every hop below is an
              artifact it already produced.
            </SectionHead>
            <div className="mt-12">
              <Attribution />
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
              n="02"
              label="the run"
              title="Forty subjects. One paint."
            >
              Detection is the easy third of the job, and it is the third that
              should cost nothing. Each question is asked at the cheapest
              representation that can answer it — structure and authored CSS
              before a browser, semantics under jsdom or Chromium, pixels only
              for differences that genuinely require one. A semantic snapshot is
              text, and painting the same page in the same process costs{" "}
              <span className="text-ivory">roughly eighteen times as much</span>
              . The milliseconds are machine-bound; the ratio is what makes
              “read it again” a design option rather than a budget line.
            </SectionHead>
            <div className="mt-12">
              <Lifecycle />
            </div>
            <p className="mt-6 font-mono text-xs text-warm">
              a green run pays nothing, so the budget goes to the subjects that
              moved
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
                <Eyebrow n="03">sensitivity</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  Assert on less, instead of ignoring more.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  A route-level test and a component-level test want opposite
                  things from the same machinery. A component asserts on
                  everything: a colour token moved and that <em>is</em> the
                  change. A route asserts the page still assembles — and a
                  design-system token landing in forty routes is noise it should
                  never have been shown.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Change frequency and change importance are inversely
                  correlated. An accessible name almost never moves and is a
                  defect when it does; anti-aliasing moves constantly and never
                  matters. So the unit here is a band, and a level is two band
                  names rather than a tolerance.
                </p>
              </div>
              <Bands />
            </div>
          </section>
        </Reveal>

        {/* Sense */}
        <Reveal>
          <section className="border-t border-hairline py-20">
            <div className="grid gap-10 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="04">sense</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  A suite that runs everything on every commit is a suite people
                  turn off.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  <span className="font-mono text-[0.95em] text-ivory">
                    --since
                  </span>{" "}
                  narrows a run to the subjects whose components a diff touched
                  — and it gives up the moment a changed file declares no
                  component. Which is exactly the file every design system is
                  most afraid of:{" "}
                  <span className="font-mono text-[0.95em]">tokens.css</span>,
                  the theme provider, the shared helper, the icon nobody thinks
                  about.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Naming the components a file <em>declares</em> cannot answer
                  for any of them, because the answer is two hops away. So this
                  half of the project reads the source rather than running it,
                  and walks those hops: what a change could have moved, and what
                  a run actually crossed.
                </p>
                <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                  A missed edge is not a smaller answer. It is a wrong one.
                </p>
              </div>
              <Since />
            </div>
          </section>
        </Reveal>

        {/* Variations — the variation compared to the subject it varies */}
        <Reveal>
          <section
            id="variations"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <div className="grid gap-10 lg:grid-cols-[2fr_3fr] [&>*]:min-w-0">
              <div>
                <Eyebrow n="05">variations</Eyebrow>
                <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                  A flag&rsquo;s second version is compared to everything except
                  the version it varies.
                </h2>
                <p className="mt-4 leading-7 text-quiet">
                  The dark scheme, the narrow viewport, the story behind{" "}
                  <span className="font-mono text-[0.95em] text-ivory">
                    checkout-v2
                  </span>{" "}
                  — each is an ordinary subject with its own baseline, green
                  from its first run. So the difference the variation exists{" "}
                  <em>for</em> is the one difference nothing measures, and what
                  the flag does to the page is recorded nowhere.
                </p>
                <p className="mt-4 leading-7 text-quiet">
                  Nothing is configured to link them. A subject is asked its own
                  name:{" "}
                  <span className="font-mono text-[0.95em]">
                    checkout-dark-narrow
                  </span>{" "}
                  varies{" "}
                  <span className="font-mono text-[0.95em]">checkout-dark</span>
                  , which varies{" "}
                  <span className="font-mono text-[0.95em]">checkout</span> —
                  longest match wins, so each link is one axis, and the whole
                  convention your suite already keeps is the declaration. Where
                  a name will not carry it, one tag —{" "}
                  <span className="font-mono text-[0.95em]">
                    variance-parent:
                  </span>{" "}
                  — states the link outright, and the record says which of the
                  two answered.
                </p>
                <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                  English will not let you say <em>green great dragon</em>. Fix
                  your axis order the same way and every subject has exactly one
                  parent, found by dropping what was added last.
                </p>
              </div>
              <Variations />
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
              n="06"
              label="the report"
              title="Before, after and diff, side by side, is where a four-pixel shift goes invisible."
            >
              Three pictures in a row also make the reader&rsquo;s eye travel
              past both things they are comparing to reach the reason the page
              is open. So the report is the comparison rather than an
              arrangement of it: a wipe whose seam follows the pointer, a blend,
              a blink, and a region overlay that lights the table row for the
              box under the cursor. Regions leads, because which boxes moved and
              who owns them is what a screenshot cannot answer.
            </SectionHead>
            <div className="mt-12">
              <DiffReport />
            </div>
            <p className="mt-6 font-mono text-xs text-warm">
              written for the tenth time it is opened rather than the first
            </p>
          </section>
        </Reveal>

        {/* Straight answers */}
        <Reveal>
          <section
            id="position"
            className="scroll-mt-24 border-t border-hairline py-20"
          >
            <SectionHead
              n="07"
              label="position"
              title="Six things you are right to be suspicious about."
            >
              Every one of these is a way visual regression has failed somebody
              before. The design answer is to absorb each cause by construction
              — and to say so plainly where a cause is absorbed by nothing.
            </SectionHead>
            <div className="mt-12">
              <Answers />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <Integration />
        </Reveal>

        <Reveal>
          <Packages />
        </Reveal>

        <Reveal>
          <ClosingCall />
        </Reveal>

        <SiteFooter />
      </main>
    </div>
  );
}
