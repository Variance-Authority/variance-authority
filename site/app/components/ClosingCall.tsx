import Mark from "./Mark";

/** The closing ask routes the reader to the integration that matches the host. */
export default function ClosingCall() {
  return (
    <section className="border-t border-hairline py-20">
      {/* Centering binds the copy and glow into one closing ask. */}
      <div className="relative overflow-hidden rounded-2xl border border-hairline bg-panel px-6 py-14 text-center sm:px-12 sm:py-16">
        <div
          aria-hidden="true"
          className="absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-orange/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-2xl">
          <Mark size={44} className="mx-auto" />
          <h2 className="mt-6 text-2xl font-bold tracking-tight text-balance text-ivory sm:text-4xl">
            Choose the host your UI already has.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-quiet">
            Playwright observes inside an existing test. Storybook and route
            suites are collected by the CLI. A jsdom test can capture a document
            for a later browser job. Start with whichever of these you already run.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#integrate"
              className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/25 ring-1 ring-inset ring-white/20 transition-transform hover:-translate-y-0.5"
            >
              Choose an integration
            </a>
            <a
              href="/docs"
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
