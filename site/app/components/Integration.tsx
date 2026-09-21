const STARTS = [
  {
    title: "Find code in your workspace",
    requires: "A readable checkout. No build or test recording needed.",
    result: "Exported names inside one import neighbourhood, with signatures, documentation, and the files that import them.",
    href: "/agents/workspace-api",
    action: "Search the source index",
  },
  {
    title: "Focus a Vitest or Jest run",
    requires: "The test-selection integration and a recorded suite run.",
    result: "Test files the next diff reaches, with the reasons they were selected.",
    href: "/reference/packages/sense",
    action: "Set up test selection",
  },
  {
    title: "Investigate a live Playwright test",
    requires: "Variance fixtures and a watcher started before the suite. Application announcements add detail.",
    result: "The suite’s progress, unfinished announced work, and authored inspection points.",
    href: "/agents/live-run",
    action: "Connect a live run",
  },
  {
    title: "Inspect or compare an interface",
    requires: "A live page for layout measurements, or a supported capture path for visual review.",
    result: "Measured presentation relationships or a comparison with an approved baseline.",
    href: "/docs/presentation",
    action: "Measure an interface",
  },
] as const;

const CAPTURES = [
  ["Playwright", "Observe a state inside an existing test; Playwright owns execution and snapshot approval.", "/start/playwright"],
  ["Rstest / Rspack", "Capture in jsdom for a later render, or observe a live page through @rstest/playwright.", "/start/rstest"],
  ["Storybook", "Collect a served or built Storybook; the CLI writes candidates for a separate acceptance step.", "/start/storybook"],
  ["Application routes", "Collect an explicit route list or sitemap. Drive authenticated states from your Playwright suite.", "/start/routes"],
  ["Vitest browser mode", "Observe a mounted component; the Vitest process renders and keeps the baseline.", "/reference/packages/vitest-browser"],
  ["Vitest or Jest under jsdom", "Capture a document in the test, then render and compare it in a separate browser job.", "/start/unit"],
] as const;

export default function Integration() {
  return (
    <section id="integrate" className="relative scroll-mt-24 border-t border-hairline py-20">
      <span id="packages" aria-hidden="true" className="absolute -top-24" />
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-orange">start here</p>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-ivory sm:text-4xl">Start with one useful answer.</h2>
      <p className="mt-5 max-w-2xl leading-7 text-quiet">
        Choose the part that fits the work in front of you. Source discovery,
        test selection, live inspection, and UI analysis have independent entry
        points. Install what that path needs.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {STARTS.map((start) => (
          <a key={start.title} href={start.href} className="group flex flex-col rounded-2xl border border-hairline bg-panel p-6 transition-colors hover:border-orange/50">
            <h3 className="text-lg font-semibold text-ivory">{start.title}</h3>
            <p className="mt-4 text-sm leading-6 text-quiet">{start.requires}</p>
            <p className="mt-3 mb-6 text-sm leading-6 text-ivory">{start.result}</p>
            <p className="mt-auto text-sm text-orange group-hover:text-ivory">{start.action} →</p>
          </a>
        ))}
      </div>
      <details className="mt-6 rounded-2xl border border-hairline bg-panel p-6">
        <summary className="cursor-pointer font-semibold text-ivory">Choose a visual review integration</summary>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-quiet">
          Capture methods differ in what they can observe, where rendering runs,
          and how baselines are approved. Start from the host your UI already uses.
        </p>
        <ul className="mt-5 divide-y divide-hairline">
          {CAPTURES.map(([title, body, href]) => (
            <li key={title} className="py-4">
              <a href={href} className="text-sm font-semibold text-orange hover:text-ivory">{title} →</a>
              <p className="mt-1 text-sm leading-6 text-quiet">{body}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
