import Answers from "./components/Answers";
import Attribution from "./components/Attribution";
import Bands from "./components/Bands";
import Lifecycle from "./components/Lifecycle";
import Since from "./components/Since";
import Timelines from "./components/Timelines";

const GITHUB = "https://github.com/Variance-Authority/variance-authority";

function Mark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 512 320"
      width={size}
      height={size * 0.625}
      aria-hidden="true"
      className={className}
    >
      <path fill="#f3f4f6" d="M64 54H159L256 266H160Z" />
      <path fill="#f3f4f6" d="M331 28H419L494 266H397Z" />
      <path fill="#ff4a19" d="M256 266L202 152L283 28H376L301 165Z" />
      <path
        fill="#d83a13"
        opacity="0.72"
        d="M202 152L256 266L301 165L264 103Z"
      />
    </svg>
  );
}

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-3 font-mono text-xs tracking-[0.2em] text-quiet uppercase">
      <span className="text-orange">{n}</span>
      <span className="h-px w-8 bg-hairline" />
      {children}
    </p>
  );
}

function Verdict() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-[2rem] bg-orange/10 blur-3xl"
      />
      <div className="relative rounded-2xl border border-hairline bg-panel/90 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-fold/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warm/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-green/60" />
          <span className="ml-2 font-mono text-xs text-quiet">
            variance run · 40 subjects · 39 settled by digest
          </span>
        </div>
        <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6">
          <code>
            <span className="text-quiet">$ variance run</span>
            {"\n"}
            <span className="text-ivory">
              1 root(s): 0 authorized, 1 to review, 0 violation(s).
            </span>
            {"\n  "}
            <span className="rounded bg-orange/15 px-1 py-0.5 text-orange">
              [needs-review]
            </span>
            <span className="text-ivory"> Button — Button</span>
            {"\n      "}
            <span className="text-quiet">
              undeclared component change: `Button` (token/paint) reached 1
              subject(s)
            </span>
            {"\n      "}
            <span className="text-ivory underline decoration-orange decoration-2 underline-offset-4">
              src/Button.js:9
            </span>
            {"\n\n"}
            <span className="text-quiet">
              $ variance accept story:button--primary
            </span>
            {"\n"}
            <span className="text-green">accepted · next run exits 0</span>
            {"\n"}
            <span className="text-quiet">$ </span>
            <span className="caret -mb-0.5 inline-block h-4 w-2 bg-orange align-middle" />
          </code>
        </pre>
      </div>
    </div>
  );
}

const RECIPES = [
  {
    pkg: "@variance-authority/playwright-test",
    when: "A Playwright suite",
    how: "One package. Existing test and expect imports stay in place; add an observation.",
  },
  {
    pkg: "@variance-authority/storybook-collector",
    when: "A built or served Storybook",
    how: "The collector owns how a story becomes ready; the CLI owns baselines, reports, acceptance, and exit codes.",
  },
  {
    pkg: "@variance-authority/route-collector",
    when: "A running app or static build",
    how: "A route list or a sitemap. Each width becomes its own subject with its own baseline and verdict.",
  },
  {
    pkg: "@variance-authority/unit-test",
    when: "Jest or Vitest under jsdom",
    how: "Capture now, render later: the unit process writes a resource-closed archive; variance run paints it elsewhere.",
  },
];

/** Roles are the `holds` column of docs/architecture.md, kept verbatim. */
const PACKAGES: { group: string; items: { name: string; role: string }[] }[] = [
  {
    group: "what you install",
    items: [
      {
        name: "cli",
        role: "the workflow, which is the one place a workflow belongs",
      },
      {
        name: "playwright-test",
        role: "additive observation and assertion helpers for a suite you already have",
      },
      {
        name: "storybook-collector",
        role: "the browser half: each story opened, made ready, and collected",
      },
      {
        name: "route-collector",
        role: "pages an application already serves, opened and collected",
      },
      {
        name: "unit-test",
        role: "resource-closed capture archives, for a later render process",
      },
      { name: "observe", role: "one composition, shipped as an example" },
      { name: "mcp", role: "the observation, exposed to an agent" },
    ],
  },
  {
    group: "what they are built on",
    items: [
      {
        name: "core",
        role: "the format, the rules, comparison, attribution, verdicts, plans",
      },
      { name: "sense", role: "the source read rather than run" },
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
      { name: "session", role: "many subjects in one standing world" },
      { name: "playwright", role: "the persistent harness, and a renderer" },
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
    ],
  },
  {
    group: "what an operator deploys",
    items: [
      { name: "server", role: "the history service the operator runs" },
      {
        name: "remote",
        role: "a renderer and a store on the other side of a hop",
      },
    ],
  },
];

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

      <main className="relative mx-auto max-w-5xl px-6">
        {/* Nav */}
        <header className="flex items-center justify-between py-6">
          <a href="#" className="flex items-center gap-3">
            <Mark />
            <span className="text-sm font-medium tracking-[0.22em] text-ivory">
              VARIANCE&nbsp;AUTHORITY
            </span>
          </a>
          <nav className="flex items-center gap-6 text-sm text-quiet">
            <a
              href="#run"
              className="hidden transition-colors hover:text-ivory sm:inline"
            >
              How it runs
            </a>
            <a
              href="#integrate"
              className="hidden transition-colors hover:text-ivory sm:inline"
            >
              Integrate
            </a>
            <a
              href={GITHUB}
              className="rounded-lg border border-hairline px-3 py-1.5 text-ivory transition-colors hover:border-orange/60"
            >
              GitHub
            </a>
          </nav>
        </header>

        {/* Hero */}
        <section className="relative pb-20 pt-14 sm:pt-16">
          <div className="relative -mx-6 mb-10 h-40 sm:h-48">
            <Timelines />
          </div>
          <div className="rise">
            <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-quiet">
              <span className="text-green">open source</span>
              <span className="text-hairline">/</span>
              <span>MIT</span>
              <span className="text-hairline">/</span>
              <span>runs in your infrastructure</span>
            </p>
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight text-ivory sm:text-6xl">
              Visual regression with{" "}
              <span className="bg-gradient-to-br from-orange to-fold bg-clip-text text-transparent">
                verifiable results.
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-quiet">
              A padding token moves. Forty screenshots fail. The tool has found
              the visual change, but the next hour belongs to a reviewer.
              Variance Authority makes that investigation part of the run: it
              connects a changed region to the component that caused it and the{" "}
              <span className="font-mono text-[0.95em] text-ivory">
                file:line
              </span>{" "}
              where that component lives. The screenshot remains evidence; it
              stops being the whole answer.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#integrate"
                className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/25 ring-1 ring-inset ring-white/20 transition-transform hover:-translate-y-0.5"
              >
                Get started
              </a>
              <a
                href={GITHUB}
                className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:border-orange/60"
              >
                Star on GitHub
              </a>
            </div>
          </div>
          <div className="rise mt-14" style={{ animationDelay: "0.15s" }}>
            <Verdict />
          </div>
        </section>

        {/* The chain — the magic */}
        <section className="border-t border-hairline py-20">
          <Eyebrow n="01">attribution</Eyebrow>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            A pixel is a poor witness. Follow it to the line that wrote it.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-quiet">
            A PNG knows colours and coordinates. It does not know that the
            changed pixels came from{" "}
            <span className="font-mono text-[0.95em] text-ivory">Title</span>,
            or that only its paint changed while its structure held. So the run
            compares the rendered document, and every hop below is an artifact
            it already produced.
          </p>
          <div className="mt-10">
            <Attribution />
          </div>
        </section>

        {/* The run */}
        <section
          id="run"
          className="scroll-mt-8 border-t border-hairline py-20"
        >
          <Eyebrow n="02">the run</Eyebrow>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            Forty subjects. One paint.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-quiet">
            Detection is the easy third of the job, and it is the third that
            should cost nothing. Each question is asked at the cheapest
            representation that can answer it — structure and authored CSS
            before a browser, semantics under jsdom or Chromium, pixels only for
            differences that genuinely require one. A semantic snapshot is text,
            and painting the same page in the same process costs{" "}
            <span className="text-ivory">roughly eighteen times as much</span>.
            The milliseconds are machine-bound; the ratio is what makes “read it
            again” a design option rather than a budget line.
          </p>
          <div className="mt-10">
            <Lifecycle />
          </div>
          <p className="mt-6 font-mono text-xs text-warm">
            a green run pays nothing, so the budget goes to the subjects that
            moved
          </p>
        </section>

        {/* Sensitivity */}
        <section className="border-t border-hairline py-20">
          <div className="grid gap-10 lg:grid-cols-[2fr_3fr]">
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
                Change frequency and change importance are inversely correlated.
                An accessible name almost never moves and is a defect when it
                does; anti-aliasing moves constantly and never matters. So the
                unit here is a band, and a level is two band names rather than a
                tolerance.
              </p>
            </div>
            <Bands />
          </div>
        </section>

        {/* Sense */}
        <section className="border-t border-hairline py-20">
          <div className="grid gap-10 lg:grid-cols-[3fr_2fr]">
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
                narrows a run to the subjects whose components a diff touched —
                and it gives up the moment a changed file declares no component.
                Which is exactly the file every design system is most afraid of:{" "}
                <span className="font-mono text-[0.95em]">tokens.css</span>, the
                theme provider, the shared helper, the icon nobody thinks about.
              </p>
              <p className="mt-4 leading-7 text-quiet">
                Naming the components a file <em>declares</em> cannot answer for
                any of them, because the answer is two hops away. So this half
                of the project reads the source rather than running it, and
                walks those hops: what a change could have moved, and what a run
                actually crossed.
              </p>
              <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
                A missed edge is not a smaller answer. It is a wrong one.
              </p>
            </div>
            <Since />
          </div>
        </section>

        {/* Straight answers */}
        <section className="border-t border-hairline py-20">
          <Eyebrow n="05">position</Eyebrow>
          <h2 className="max-w-xl text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            Six things you are right to be suspicious about.
          </h2>
          <p className="mt-4 mb-10 max-w-2xl leading-7 text-quiet">
            Every one of these is a way visual regression has failed somebody
            before. The design answer is to absorb each cause by construction —
            and to say so plainly where a cause is absorbed by nothing.
          </p>
          <Answers />
        </section>

        {/* Integration */}
        <section
          id="integrate"
          className="scroll-mt-8 border-t border-hairline py-20"
        >
          <Eyebrow n="06">integrate</Eyebrow>
          <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            One package where your UI is already ready
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-quiet">
            No new way to write tests, no hosted setup. Pick the recipe that
            matches where your UI states already live.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
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

          <div className="mt-10 grid gap-4 lg:grid-cols-[3fr_2fr]">
            <div className="rounded-2xl border border-hairline bg-panel">
              <p className="border-b border-hairline px-5 py-2.5 font-mono text-xs text-quiet">
                cart.spec.ts — a Playwright suite, unchanged apart from the
                observation
              </p>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6 text-ivory">
                <code>
                  <span className="text-warm">import</span> {"{ test, expect }"}{" "}
                  <span className="text-warm">from</span>{" "}
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
                  <span className="text-green">
                    'https://example.test/cart'
                  </span>
                  );{"\n  "}
                  await page.getByRole(
                  <span className="text-green">'button'</span>, {"{ name: "}
                  <span className="text-green">'Clear'</span>
                  {" }"}).click();{"\n\n  "}
                  <span className="text-warm">const</span> observation ={" "}
                  <span className="text-warm">await</span>{" "}
                  <span className="text-orange">observe</span>(page,
                  page.getByTestId(<span className="text-green">'cart'</span>),
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
            <div className="flex flex-col rounded-2xl border border-hairline bg-panel">
              <p className="border-b border-hairline px-5 py-2.5 font-mono text-xs text-quiet">
                the whole loop, for Storybook and route suites
              </p>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-7 text-ivory">
                <code>
                  <span className="text-quiet">$</span> variance run{"\n"}
                  <span className="text-quiet">$</span> variance report --format
                  html
                  {"\n"}
                  <span className="text-quiet">$</span> variance accept
                  story:checkout--empty{"\n"}
                  <span className="text-quiet">$</span> variance run{" "}
                  <span className="text-green"># exit 0</span>
                </code>
              </pre>
              <p className="border-t border-hairline px-5 py-4 text-sm leading-6 text-quiet">
                The first run reports every subject as{" "}
                <span className="font-mono text-[0.95em]">new</span> and exits 1
                — a baseline nobody approved is not a pass. The report is one
                HTML file beside the JSON: no account, no upload step, nothing
                to keep running. Stabilization is on by default; animations are
                pinned, fonts and images waited for, scrollbars hidden, before
                anything is read.
              </p>
            </div>
          </div>
        </section>

        {/* Packages */}
        <section className="border-t border-hairline py-20">
          <Eyebrow n="07">packages</Eyebrow>
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            There is no pipeline. There are tools.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-quiet">
            A fixed sequence encodes one team&rsquo;s workflow and fails the
            next. What ships instead is a set of kinds — acquire, prepare,
            render, hash, compare, isolate, map, judge, record — and a pipeline
            is something you assemble from them. Two of those kinds need a host:
            a DOM to acquire from, a browser to render in. Three need nothing at
            all, and that distribution is the whole economic argument.
          </p>
          <div className="mt-10 space-y-8">
            {PACKAGES.map((g) => (
              <div key={g.group}>
                <p className="mb-3 flex items-center gap-3 font-mono text-[11px] tracking-[0.16em] text-warm uppercase">
                  {g.group}
                  <span className="h-px flex-1 bg-hairline" />
                  <span className="text-quiet">{g.items.length}</span>
                </p>
                {/* Cells carry their own hairlines so a short last row stays panel-coloured. */}
                <div className="grid overflow-hidden rounded-2xl border border-hairline bg-panel sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((p) => (
                    <div
                      key={p.name}
                      className="group border-b border-r border-hairline p-5 transition-colors hover:bg-charcoal"
                    >
                      <p className="font-mono text-[13px] text-ivory transition-colors group-hover:text-orange">
                        <span className="text-quiet">@variance-authority/</span>
                        {p.name}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-quiet">
                        {p.role}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-2xl font-mono text-xs leading-5 text-warm">
            <span className="text-orange">{"//"}</span> a consumer knows one
            package: adopter-facing code names its immediate neighbour, never
            its neighbour&rsquo;s collaborators
          </p>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-hairline py-20">
          <div className="relative overflow-hidden rounded-2xl border border-hairline bg-panel p-8 sm:p-12">
            <div
              aria-hidden="true"
              className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-orange/10 blur-3xl"
            />
            <Mark
              size={64}
              className="absolute right-8 top-8 hidden opacity-20 sm:block"
            />
            <h2 className="max-w-xl text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
              Point it at UI you already have.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-quiet">
              A Storybook, a route list, a Playwright suite — the first verdict
              is four commands away, and the first thing it hands you is a{" "}
              <span className="font-mono text-ivory">file:line</span>.
            </p>
            <div className="mt-6 inline-flex max-w-full items-center gap-3 overflow-x-auto rounded-lg border border-hairline bg-deep px-4 py-3 font-mono text-[13px] text-ivory">
              <span className="select-none text-quiet">$</span>
              npm i -D @variance-authority/cli
              @variance-authority/storybook-collector
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
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
        </section>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-10 text-sm text-quiet">
          <div className="flex items-center gap-3">
            <Mark size={22} />
            <span>MIT · Copyright © 2026 Mechanic Garden</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href={`${GITHUB}/tree/main/docs`}
              className="transition-colors hover:text-ivory"
            >
              Docs
            </a>
            <a href={GITHUB} className="transition-colors hover:text-ivory">
              GitHub
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
