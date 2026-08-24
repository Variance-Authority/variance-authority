import SectionHead from "./SectionHead";

const RECIPES = [
  {
    pkg: "@variance-authority/playwright-test",
    when: "A Playwright suite",
    how: "Add one observation to an existing test. Keep the test and expect imports you already use.",
  },
  {
    pkg: "@variance-authority/storybook-collector",
    when: "A built or served Storybook",
    how: "Collect stories from an existing build or dev server. The CLI handles baselines, reports, acceptance, and CI.",
  },
  {
    pkg: "@variance-authority/route-collector",
    when: "A running app or static build",
    how: "Provide a route list or sitemap. Each viewport gets its own baseline and result.",
  },
  {
    pkg: "@variance-authority/unit-test",
    when: "Jest or Vitest under jsdom",
    how: "Capture the document in jsdom, then render it later in a local or remote browser.",
  },
];

/** Where a suite already is, and the one package that meets it there. */
export default function Integration() {
  return (
    <section
      id="integrate"
      className="scroll-mt-24 border-t border-hairline py-20"
    >
      <SectionHead
        n="08"
        label="integrate"
        title="Start where your UI already runs."
      >
        Keep your existing tests and rendering setup. Choose the collector that
        meets your UI where it already runs.
      </SectionHead>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        {RECIPES.map((r) => (
          <div
            key={r.pkg}
            className="group rounded-2xl border border-hairline bg-panel p-6 transition-all hover:-translate-y-1 hover:border-orange/50"
          >
            <p className="text-sm font-semibold text-ivory">{r.when}</p>
            <p className="mt-3 text-sm leading-6 text-quiet">{r.how}</p>
            <p className="mt-4 border-t border-hairline pt-3 font-mono text-[13px] text-warm transition-colors group-hover:text-orange">
              <span className="select-none text-quiet">npm i -D </span>
              {r.pkg}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        <div className="rounded-2xl border border-hairline bg-panel">
          <p className="border-b border-hairline px-5 py-2.5 font-mono text-xs text-quiet">
            cart.spec.ts — an existing Playwright test with one observation
          </p>
          {/* This one is code, so it scrolls where the terminal above
              wraps. Narrow enough and the lines simply stop at the
              panel's edge, which reads as a cropped screenshot; the fade
              is what says the panel moves. */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 rounded-r-2xl bg-gradient-to-l from-panel to-transparent md:hidden"
            />
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6 text-ivory">
              <code>
                <span className="text-warm">import</span>{" "}
                {"{ test, expect }"} <span className="text-warm">from</span>{" "}
                <span className="text-green">'@playwright/test'</span>;{"\n"}
                <span className="text-warm">import</span>{" "}
                {"{ assertUnchanged, observe }"}
                {"\n  "}
                <span className="text-warm">from</span>{" "}
                <span className="text-green">
                  '@variance-authority/playwright-test'
                </span>
                ;{"\n\n"}
                <span className="text-ivory">test(</span>
                <span className="text-green">
                  'the cart survives an empty basket'
                </span>
                <span className="text-ivory">
                  , async ({"{ page }"}, testInfo) {"=> {"}
                </span>
                {"\n  "}await page.goto(
                <span className="text-green">'https://example.test/cart'</span>
                );{"\n  "}
                await page.getByRole(
                <span className="text-green">'button'</span>, {"{ name: "}
                <span className="text-green">'Clear'</span>
                {" }"}).click();{"\n\n  "}
                <span className="text-warm">const</span> observation ={" "}
                <span className="text-warm">await</span>{" "}
                <span className="text-orange">observe</span>(page,
                page.getByTestId(
                <span className="text-green">'cart'</span>
                ),
                {"\n    "}
                testInfo, {"{ subjectId: "}
                <span className="text-green">'cart/empty'</span>
                {" }"});{"\n\n  "}
                <span className="text-orange">assertUnchanged</span>
                (observation);{"\n"}
                {"}"});
              </code>
            </pre>
          </div>
        </div>
        <div className="flex flex-col rounded-2xl border border-hairline bg-panel">
          <p className="border-b border-hairline px-5 py-2.5 font-mono text-xs text-quiet">
            the review loop for Storybook and route suites
          </p>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-7 text-ivory">
            <code>
              <span className="text-quiet">$</span> variance run{"\n"}
              <span className="text-quiet">$</span> variance report --format html
              {"\n"}
              <span className="text-quiet">$</span> variance accept
              story:checkout--empty{"\n"}
              <span className="text-quiet">$</span> variance run{" "}
              <span className="text-green"># exit 0</span>
            </code>
          </pre>
          <p className="border-t border-hairline px-5 py-4 text-sm leading-6 text-quiet">
            The first run reports every subject as{" "}
            <span className="font-mono text-[0.95em]">new</span> and exits 1 — a
            new baseline still needs review. The report is one HTML file beside
            the JSON, with no account or upload step. Before capture, animations
            are pinned, fonts and images are loaded, and scrollbars are hidden.
          </p>
        </div>
      </div>
    </section>
  );
}
