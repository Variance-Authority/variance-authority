import { PACKAGE_DOCUMENTS } from "../content/package-docs";

/**
 * How far the last card must stretch to finish its row. A grid of n over c
 * columns leaves `n % c` cards on the final row; widening the last one by the
 * shortfall closes it, so a group never shows bordered gaps where a reader
 * would look for packages that are not there.
 */
function fill(n: number, cols: number): number {
  const rest = n % cols;
  return rest === 0 ? 1 : cols - rest + 1;
}

/** What you already have, and the command that acts on it. */
const ROUTES: {
  have: string;
  install: string[];
  outcome: string;
  more?: { href: string; label: string };
}[] = [
  {
    have: "A Playwright Test suite, and you want screenshots compared",
    install: [
      "npm install --save-dev @variance-authority/playwright-test @playwright/test",
      "npx playwright install chromium",
    ],
    outcome: "Your suite keeps its runner, fixtures and matchers. Call observe() on a Locator the test already reached; the approved image lands under .variance/baselines, the next run compares against it, and you approve a change with Playwright's own --update-snapshots=changed. You do not need the CLI.",
    more: { href: "/start/playwright", label: "Observe a Playwright test" },
  },
  {
    have: "A built Storybook, or routes an application already serves",
    install: [
      "npm install --save-dev @variance-authority/cli @variance-authority/storybook-collector",
      "npx playwright install chromium",
    ],
    outcome: "Here the CLI is the runner: variance collects every story, compares it, writes the report, and accepts what you approve, all from one config file. Swap storybook-collector for route-collector to walk URLs instead of stories.",
    more: { href: "/start/storybook", label: "Observe a Storybook" },
  },
  {
    have: "A Vitest or Jest suite, and you want to run fewer tests after a change",
    install: ["npm install --save-dev @variance-authority/sense"],
    outcome: "withTestSelection wraps the config you already have and writes an execution index as the suite runs: which source regions each test file entered. coveringTests then answers which tests reached a changed line, and variance run --since origin/main selects on the same index.",
    more: { href: "/docs/selecting", label: "Select the tests that matter" },
  },
];

/** Package roles grouped by an adopter's next action. */
const PACKAGES: {
  group: string;
  note?: string;
  items: { name: string; role: string }[];
}[] = [
  {
    group: "what you install",
    note: "Published on npm under MIT, all at one version. Each name links to its reference page, which names the public contract, the setup, and the limits.",
    items: [
      {
        name: "cli",
        role: "collect, compare, render, report, accept — the whole workflow from one config. The only package that installs a binary, variance",
      },
      {
        name: "playwright-test",
        role: "visual comparison added to a Playwright suite you already have: screenshot a Locator, compare it against the approved baseline, approve through Playwright's own update flag. This is the package a Playwright suite installs — not @variance-authority/playwright below",
      },
      {
        name: "storybook-collector",
        role: "the browser half: each story opened, made ready, and collected. Install it beside the CLI, which runs it",
      },
      {
        name: "route-collector",
        role: "pages an application already serves, opened and collected. Install it beside the CLI, which runs it",
      },
      {
        name: "sense",
        role: "which source regions each test entered, and which tests a change reaches. Install this one to run fewer Vitest or Jest tests after a change",
      },
      {
        name: "editors",
        role: "the VS Code and JetBrains plugins, built: which test cases went through each line, in the gutter, from a run the CLI recorded",
      },
      {
        name: "vitest-browser",
        role: "the mounted component read and judged inside a browser-mode test",
      },
      {
        name: "unit-test",
        role: "resource-closed capture archives, rendered and compared later by the CLI",
      },
      {
        name: "observe",
        role: "document and raster observation for custom integrations",
      },
      { name: "mcp", role: "the observation, exposed to an agent" },
      {
        name: "help",
        role: "what a workspace publishes, ranked by what imports it, answered on demand",
      },
      {
        name: "presentation",
        role: "one interface's presentation graph, independent ARIA evidence, relationship findings, and removable diagnostic paint — a report to read, with nothing to approve and no verdict to gate on",
      },
      {
        name: "scenario",
        role: "witnessed AAA paths, transition effects, and a partial state machine — again with no baseline behind it",
      },
      {
        name: "eyes",
        role: "selector and locator attention during a run, retained with React attribution",
      },
      {
        name: "distill",
        role: "what one test loaded and ran, minus what it demonstrably addressed — the boundary that test may not need, with a substitution to try",
      },
      {
        name: "event",
        role: "announcements a running system makes about its own decisions, while it is still executing",
      },
      {
        name: "vantage",
        role: "what each in-flight test heard, and work that never ended",
      },
      {
        name: "ioc",
        role: "module-level state that outlives the test that wrote it, reset by the module that owns it on the runner's schedule — wiring a test run drives and a production build ignores",
      },
    ],
  },
  {
    group: "what they are built on",
    note: "These arrive as dependencies of the packages above, so a working setup never lists them. Install one directly only when you are composing your own integration.",
    items: [
      {
        name: "core",
        role: "the format, the rules, comparison, attribution, verdicts, plans",
      },
      { name: "dom", role: "extraction, and CSS applicability pruning" },
      { name: "react", role: "fibers → owner chains, props digests, portals" },
      {
        name: "jsx-source",
        role: "the file and line that wrote an element, carried as far as the DOM node",
      },
      {
        name: "raster",
        role: "the pixel tier as data — contracts, policies, the gate",
      },
      { name: "png", role: "decoding, comparison, the diff image" },
      {
        name: "png-sharp",
        role: "the same comparison with the decoding done natively. Optional: install it beside @variance-authority/png when you want that, and nothing breaks if you never do",
      },
      { name: "session", role: "many subjects in one standing world" },
      {
        name: "playwright",
        role: "the persistent harness, and a renderer. Read the name carefully: this is the low-level harness a custom integration drives, not the package a Playwright suite installs",
      },
      {
        name: "storybook",
        role: "a project's own stories as a subject list",
      },
      { name: "store", role: "baselines on disk, and in git-LFS" },
      {
        name: "report",
        role: "what a run leaves behind, so several readers share one shape",
      },
      {
        name: "history",
        role: "what a row may contain, and what the numbers mean",
      },
      {
        name: "package",
        role: "what a package offers an adopter: every entrypoint a manifest opens",
      },
      {
        name: "wire",
        role: "one execution identity and one address shared across process boundaries",
      },
    ],
  },
  {
    group: "what an operator deploys",
    note: "Services someone hosts for a whole team, rather than something each checkout installs. If nobody at your company has stood one up, you do not need these to run anything above.",
    items: [
      { name: "server", role: "the history service the operator runs" },
      {
        name: "remote",
        role: "a renderer and a store on the other side of a hop",
      },
      {
        name: "tribunal",
        role: "baselines, history, and review-and-approve, in an account you control",
      },
    ],
  },
];

const presentedNames = PACKAGES.flatMap(({ items }) =>
  items.map(({ name }) => name),
);
const inventoryMatches =
  presentedNames.length === PACKAGE_DOCUMENTS.length &&
  new Set(presentedNames).size === presentedNames.length &&
  PACKAGE_DOCUMENTS.every(({ name }) => presentedNames.includes(name));

if (!inventoryMatches) {
  throw new Error("Package map must classify every documented package once");
}

/** The kinds on offer, grouped by what a reader does with them. */
export default function Packages() {
  return (
    <section id="packages" className="doc-section scroll-mt-24">
      <h2>Start from what you already have</h2>
      <p>
        Pick the row that matches your project and run the command in it.{" "}
        <a href="/start">Observe one state</a> walks the rest of the loop from
        there.
      </p>
      <div className="mt-6 space-y-6">
        {ROUTES.map((route) => (
          <div
            key={route.have}
            className="rounded-2xl border border-hairline bg-panel p-5"
          >
            <p className="text-sm leading-6 text-ivory">{route.have}</p>
            <pre className="mt-3 overflow-x-auto rounded-xl border border-hairline bg-deep p-4 font-mono text-[11px] leading-5 text-quiet">
              {route.install.join("\n")}
            </pre>
            <p className="mt-3 max-w-2xl text-xs leading-5 text-quiet">
              {route.outcome}
            </p>
            {route.more ? (
              <p className="mt-3 text-xs leading-5">
                <a href={route.more.href}>{route.more.label}</a>
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <h2 id="responsibility" className="scroll-mt-24">
        Choose by responsibility
      </h2>
      <p>
        Everything published is below. The first group is what you add to a
        project; the rest are named so you can recognise them when they appear
        in a lockfile or a stack trace.
      </p>
      <div className="mt-8 space-y-8">
        {PACKAGES.map((g) => {
          const n = g.items.length;
          const lgCols = n < 3 ? n : 3;
          const SM = ["", "", "sm:col-span-2"][fill(n, 2)];
          const LG = ["", "", "lg:col-span-2", "lg:col-span-3"][
            fill(n, lgCols)
          ];
          return (
            <div key={g.group}>
              <p className="mb-3 flex items-center gap-3 font-mono text-[11px] tracking-[0.16em] text-warm uppercase">
                {g.group}
                <span className="h-px flex-1 bg-hairline" />
                <span className="text-quiet">{n}</span>
              </p>
              {g.note ? (
                <p className="mb-3 max-w-2xl text-xs leading-5 text-quiet">
                  {g.note}
                </p>
              ) : null}
              {/* Cells carry their own hairlines so a short last row stays panel-coloured. */}
              <div
                className={`grid overflow-hidden rounded-2xl border border-hairline bg-panel sm:grid-cols-2 [&>*]:min-w-0 ${
                  n < 3 ? "lg:grid-cols-2" : "lg:grid-cols-3"
                }`}
              >
                {g.items.map((p, idx) => (
                  <a
                    key={p.name}
                    href={`/reference/packages/${p.name}`}
                    className={`group border-b border-r border-hairline p-5 transition-colors hover:bg-charcoal ${
                      idx === n - 1 ? `${SM} ${LG}` : ""
                    }`}
                  >
                    <p className="font-mono text-[13px] text-ivory transition-colors group-hover:text-orange">
                      <span className="text-quiet">@variance-authority/</span>
                      {p.name}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-quiet">
                      {p.role}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
