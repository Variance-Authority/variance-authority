import { GITHUB } from "../links";
import SectionHead from "./SectionHead";

const RECIPES = [
  {
    key: "playwright",
    title: "Existing Playwright suite",
    install:
      "@variance-authority/playwright-test @playwright/test · Chromium",
    requires: "A Playwright test and a bounded Locator.",
    result: "The observation and verdict live in Playwright test output.",
    href: GITHUB + "/tree/main/packages/playwright-test",
  },
  {
    key: "storybook",
    title: "Built or served Storybook",
    install:
      "@variance-authority/cli @variance-authority/storybook-collector · Chromium",
    requires: "A reachable Storybook index and its stories.",
    result: "The CLI writes candidate baselines and one review report.",
    href: GITHUB + "/tree/main/packages/storybook-collector",
  },
  {
    key: "routes",
    title: "Running app or static build",
    install:
      "@variance-authority/cli @variance-authority/route-collector · Chromium",
    requires:
      "An explicit route list or sitemap. Authenticated routes are outside this path; drive those from the Playwright suite.",
    result: "Each route and viewport becomes a separately reviewable UI state.",
    href: GITHUB + "/tree/main/packages/route-collector",
  },
  {
    key: "jsdom",
    title: "Vitest or Jest under jsdom",
    install:
      "@variance-authority/unit-test jsdom · CLI and Chromium in the render job",
    requires: "A capture job and a later browser render job.",
    result: "The test writes a document capture; the CLI renders and compares it.",
    href: GITHUB + "/tree/main/packages/unit-test",
  },
] as const;

/** Pick the integration by the process that already owns the UI. */
export default function Integration() {
  return (
    <section
      id="integrate"
      className="relative scroll-mt-24 border-t border-hairline py-20"
    >
      <span
        id="packages"
        aria-hidden="true"
        className="absolute -top-24"
      />
      <SectionHead
        n="09"
        label="start here"
        title="Start where the UI already runs."
      >
        All four paths produce the same evidence and the same report format.
        They differ in which tool drives the run, what you have to stand up, and
        where baseline approval happens. Pick the one that matches the host your
        UI already runs in.
      </SectionHead>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        {RECIPES.map((recipe) => (
          <a
            key={recipe.key}
            href={recipe.href}
            className="group rounded-2xl border border-hairline bg-panel p-6 transition-all hover:-translate-y-1 hover:border-orange/50"
          >
            <p className="text-base font-semibold text-ivory">{recipe.title}</p>
            <p className="mt-4 font-mono text-[11px] leading-5 text-orange">
              {recipe.install}
            </p>
            <dl className="mt-5 space-y-3 border-t border-hairline pt-4 text-sm leading-6">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm">
                  requires
                </dt>
                <dd className="mt-1 text-quiet">{recipe.requires}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-warm">
                  first result
                </dt>
                <dd className="mt-1 text-quiet">{recipe.result}</dd>
              </div>
            </dl>
            <p className="mt-5 font-mono text-xs text-orange transition-colors group-hover:text-ivory">
              setup and boundaries →
            </p>
          </a>
        ))}
      </div>

      <p className="mt-6 font-mono text-xs text-quiet">
        These four are the entry points. Every package behind them is listed
        in{" "}
        <a
          href="/docs/architecture"
          className="text-orange transition-colors hover:text-ivory"
        >
          architecture.md →
        </a>
      </p>

      <div className="mt-10 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="rounded-2xl border border-hairline bg-panel">
          <p className="border-b border-hairline px-5 py-3 font-mono text-xs text-quiet">
            Playwright owns execution and approval
          </p>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-7 text-ivory">
            <code>
              <span className="text-quiet">$</span> npx playwright test{"\n"}
              <span className="text-quiet">$</span> npx playwright test
              --update-snapshots=all
            </code>
          </pre>
          <p className="border-t border-hairline px-5 py-4 text-sm leading-6 text-quiet">
            Variance Authority observes and asserts inside the Playwright test.
            Baselines only change when you run Playwright’s explicit snapshot
            update.
          </p>
        </div>

        <div className="rounded-2xl border border-hairline bg-panel">
          <p className="border-b border-hairline px-5 py-3 font-mono text-xs text-quiet">
            Collected suites use the CLI lifecycle
          </p>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-7 text-ivory">
            <code>
              <span className="text-quiet">$</span> variance run{"\n"}
              <span className="text-quiet">$</span> variance report --format html
              {"\n"}
              <span className="text-quiet">$</span> variance accept &lt;subject&gt;
            </code>
          </pre>
          <p className="border-t border-hairline px-5 py-4 text-sm leading-6 text-quiet">
            Storybook, route, and captured-document paths write candidate
            baselines first. You accept them with a separate CLI command.
          </p>
        </div>
      </div>
    </section>
  );
}
