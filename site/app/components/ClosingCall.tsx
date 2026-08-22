import { GITHUB } from "../links";
import Mark from "./Mark";

/** The closing ask: the install line, and the two places to go next. */
export default function ClosingCall() {
  return (
    <section className="border-t border-hairline py-20">
      {/* Centred. Left-aligned at this width the copy ran to half the
          panel and the other half was a glow, which read as an unfinished
          row rather than a closing ask. */}
      <div className="relative overflow-hidden rounded-2xl border border-hairline bg-panel px-6 py-14 text-center sm:px-12 sm:py-16">
        <div
          aria-hidden="true"
          className="absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-orange/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-2xl">
          <Mark size={44} className="mx-auto" />
          <h2 className="mt-6 text-2xl font-bold tracking-tight text-balance text-ivory sm:text-4xl">
            Point it at UI you already have.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-quiet">
            A Storybook, a route list, a Playwright suite — the first verdict is
            four commands away, and the first thing it hands you is a{" "}
            <span className="font-mono text-[0.95em] text-ivory">file:line</span>
            .
          </p>
          <div className="mt-8 flex justify-center">
            <div className="inline-flex max-w-full items-center gap-3 overflow-x-auto rounded-lg border border-hairline bg-deep px-4 py-3 text-left font-mono text-[13px] text-ivory">
              <span className="select-none text-quiet">$</span>
              npm i -D @variance-authority/cli
              @variance-authority/storybook-collector
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href={GITHUB}
              className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/25 ring-1 ring-inset ring-white/20 transition-transform hover:-translate-y-0.5"
            >
              Star on GitHub
            </a>
            <a
              href={`${GITHUB}/tree/main/docs`}
              className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:border-orange/60"
            >
              Read the docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
