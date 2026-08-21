const GITHUB = "https://github.com/Variance-Authority/variance-authority";

function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
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
      <path fill="#d83a13" opacity="0.72" d="M202 152L256 266L301 165L264 103Z" />
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
            <span className="text-ivory">1 root(s): 0 authorized, 1 to review, 0 violation(s).</span>
            {"\n  "}
            <span className="rounded bg-orange/15 px-1 py-0.5 text-orange">[needs-review]</span>
            <span className="text-ivory"> Button — Button</span>
            {"\n      "}
            <span className="text-quiet">
              undeclared component change: `Button` (token/paint) reached 1 subject(s)
            </span>
            {"\n      "}
            <span className="text-ivory underline decoration-orange decoration-2 underline-offset-4">
              src/Button.js:9
            </span>
            {"\n\n"}
            <span className="text-quiet">$ variance accept story:button--primary</span>
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

const STAGES = [
  {
    n: "1",
    stage: "detect",
    question: "Did anything move?",
    cost: "Almost nothing. A subject whose document digest equals its baseline's is settled without a render.",
    active: false,
  },
  {
    n: "2",
    stage: "adjudicate",
    question: "Is the movement real, and is it this subject's?",
    cost: "One collection per changed subject — and never a paint.",
    active: false,
  },
  {
    n: "3",
    stage: "attribute",
    question: "What caused it, and where is it written?",
    cost: "A fold over digests the run already produced, ending in a file:line your editor can open.",
    active: true,
  },
];

const REFUSALS = [
  {
    title: "No vendor account. No hosted dashboard.",
    body: "It runs in infrastructure you control, against UI states your Storybook, application, Playwright tests, or browserless unit tests already reach. Capture material stays local or travels only to a renderer and store you choose.",
  },
  {
    title: "Missing evidence is not a pass.",
    body: "When a profile cannot observe a band, the report says unobserved. It does not turn what it failed to see into a green check.",
  },
  {
    title: "Retries are not an answer.",
    body: "A changed subject is read again (same world, time advanced) and alone (world rebuilt). Both outcomes are reported, nothing is cleared, and accept refuses to promote a reading chosen by a race.",
  },
  {
    title: "Bands, not thresholds.",
    body: "A threshold absorbs anything small enough — including small real changes. A sensitivity band absorbs exactly one kind of thing, however large. A route declared layout still reports a nav that moved by one pixel.",
  },
  {
    title: "The exit code is the whole interface.",
    body: "0: nothing to review. 1: changes to review. 2: operator error. A verdict and a crash never share a code, so any CI that can run a command already has the gate.",
  },
  {
    title: "“No per-shot bill” is not the same claim as “free.”",
    body: "There is no vendor meter. You pay in compute and storage you already own — and the run is engineered so a green subject costs a hash comparison, not a render.",
  },
];

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

export default function Page() {
  return (
    <div className="relative overflow-x-clip">
      {/* Hero backdrop: node grid + one warm glow, top of page only */}
      <div aria-hidden="true" className="dot-grid absolute inset-x-0 top-0 h-[42rem]" />
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
            <a href="#integrate" className="hidden transition-colors hover:text-ivory sm:inline">
              Integrate
            </a>
            <a
              href={`${GITHUB}/tree/main/docs`}
              className="hidden transition-colors hover:text-ivory sm:inline"
            >
              Docs
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
        <section className="pb-20 pt-14 sm:pt-20">
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
              A padding token moves. Forty screenshots fail. The tool has found the visual
              change, but the next hour belongs to a reviewer. Variance Authority makes
              that investigation part of the run: it connects a changed region to the
              component that caused it and the{" "}
              <span className="font-mono text-[0.95em] text-ivory">file:line</span> where
              that component lives. The screenshot remains evidence; it stops being the
              whole answer.
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
          <div className="rise mt-16" style={{ animationDelay: "0.15s" }}>
            <Verdict />
          </div>
        </section>

        {/* Three stages */}
        <section className="border-t border-hairline py-20">
          <Eyebrow n="01">the run</Eyebrow>
          <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            One change. One place to look.
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-quiet">
            Finding that something moved is the easy third of the job. The other two are
            deciding whether the movement is real, and saying what caused it — and in
            most of this category they are the reader&rsquo;s problem, handed over as a
            red rectangle. Here they are the run&rsquo;s problem, asked at the cheapest
            representation that can answer: structure and authored CSS before a browser,
            semantics under jsdom or Chromium, pixels only for differences that genuinely
            require rendering.
          </p>
          <div className="relative mt-12 grid gap-4 sm:grid-cols-3">
            {/* the connector through the three stages */}
            <div
              aria-hidden="true"
              className="absolute -top-0 left-[8%] right-[8%] hidden h-px bg-hairline sm:block"
              style={{ top: "2.4rem" }}
            />
            {STAGES.map((s) => (
              <div
                key={s.stage}
                className={`relative rounded-2xl border p-6 transition-transform hover:-translate-y-1 ${
                  s.active
                    ? "border-orange/50 bg-orange/[0.06] shadow-lg shadow-orange/10"
                    : "border-hairline bg-panel"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full border font-mono text-xs ${
                      s.active
                        ? "border-orange bg-orange text-deep"
                        : "border-hairline bg-deep text-quiet"
                    }`}
                  >
                    {s.n}
                  </span>
                  <p className={`font-mono text-sm ${s.active ? "text-orange" : "text-warm"}`}>
                    {s.stage}
                  </p>
                </div>
                <p className="mt-4 font-semibold text-ivory">{s.question}</p>
                <p className="mt-3 text-sm leading-6 text-quiet">{s.cost}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 font-mono text-xs text-warm">
            the third stage is the one the red rectangle never reaches — and it is where
            this tool ends every run
          </p>
        </section>

        {/* Straight answers — a ledger, not cards */}
        <section className="border-t border-hairline py-20">
          <div className="grid gap-10 lg:grid-cols-[2fr_3fr]">
            <div className="lg:sticky lg:top-10 lg:self-start">
              <Eyebrow n="02">position</Eyebrow>
              <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
                Straight answers
              </h2>
              <p className="mt-4 leading-7 text-quiet">
                Yes, visual regression is flaky. Anyone who says otherwise has either not
                run it at scale or has quietly set a threshold large enough to hide it.
                The design answer is to absorb each cause of variance by construction —
                and to say so plainly when a cause is absorbed by nothing.
              </p>
            </div>
            <ul className="divide-y divide-hairline border-y border-hairline">
              {REFUSALS.map((r) => (
                <li key={r.title} className="group flex gap-4 py-5">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-hairline transition-colors group-hover:bg-orange" />
                  <div>
                    <p className="font-semibold text-ivory">{r.title}</p>
                    <p className="mt-2 text-sm leading-6 text-quiet">{r.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Integration */}
        <section id="integrate" className="scroll-mt-8 border-t border-hairline py-20">
          <Eyebrow n="03">integrate</Eyebrow>
          <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
            One package where your UI is already ready
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-quiet">
            No new way to write tests, no hosted setup. Pick the recipe that matches
            where your UI states already live.
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
                cart.spec.ts — a Playwright suite, unchanged apart from the observation
              </p>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6 text-ivory">
                <code>
                  <span className="text-warm">import</span> {"{ test, expect }"}{" "}
                  <span className="text-warm">from</span>{" "}
                  <span className="text-green">'@playwright/test'</span>;{"\n"}
                  <span className="text-warm">import</span> {"{ assertUnchanged, observe }"}
                  {"\n  "}
                  <span className="text-warm">from</span>{" "}
                  <span className="text-green">'@variance-authority/playwright-test'</span>;
                  {"\n\n"}
                  <span className="text-ivory">test(</span>
                  <span className="text-green">'the cart survives an empty basket'</span>
                  <span className="text-ivory">
                    , async ({"{ page }"}, testInfo) {"=> {"}
                  </span>
                  {"\n  "}await page.goto(
                  <span className="text-green">'https://example.test/cart'</span>);{"\n  "}
                  await page.getByRole(<span className="text-green">'button'</span>,{" "}
                  {"{ name: "}
                  <span className="text-green">'Clear'</span>
                  {" }"}).click();{"\n\n  "}
                  <span className="text-warm">const</span> observation ={" "}
                  <span className="text-warm">await</span>{" "}
                  <span className="text-orange">observe</span>(page,
                  page.getByTestId(<span className="text-green">'cart'</span>),{"\n    "}
                  testInfo, {"{ subjectId: "}
                  <span className="text-green">'cart/empty'</span>
                  {" }"});{"\n\n  "}
                  <span className="text-orange">assertUnchanged</span>(observation);{"\n"}
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
                baseline nobody approved is not a pass. The report is one HTML file
                beside the JSON: no account, no upload step, nothing to keep running.
                Stabilization is on by default; animations are pinned, fonts and images
                waited for, scrollbars hidden, before anything is read.
              </p>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-hairline py-20">
          <div className="relative overflow-hidden rounded-2xl border border-hairline bg-panel p-8 sm:p-12">
            <div
              aria-hidden="true"
              className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-orange/10 blur-3xl"
            />
            <Mark size={64} className="absolute right-8 top-8 hidden opacity-20 sm:block" />
            <h2 className="max-w-xl text-2xl font-bold tracking-tight text-ivory sm:text-4xl">
              Point it at UI you already have.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-quiet">
              A Storybook, a route list, a Playwright suite — the first verdict is four
              commands away, and the first thing it hands you is a{" "}
              <span className="font-mono text-ivory">file:line</span>.
            </p>
            <div className="mt-6 inline-flex max-w-full items-center gap-3 overflow-x-auto rounded-lg border border-hairline bg-deep px-4 py-3 font-mono text-[13px] text-ivory">
              <span className="select-none text-quiet">$</span>
              npm i -D @variance-authority/cli @variance-authority/storybook-collector
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
            <a href={`${GITHUB}/tree/main/docs`} className="transition-colors hover:text-ivory">
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
