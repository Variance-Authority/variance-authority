const GITHUB = "https://github.com/Variance-Authority/variance-authority";

function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 320" width={size} height={size * 0.625} aria-hidden="true">
      <path fill="#f3f4f6" d="M64 54H159L256 266H160Z" />
      <path fill="#f3f4f6" d="M331 28H419L494 266H397Z" />
      <path fill="#ff4a19" d="M256 266L202 152L283 28H376L301 165Z" />
      <path fill="#d83a13" opacity="0.72" d="M202 152L256 266L301 165L264 103Z" />
    </svg>
  );
}

function Verdict() {
  return (
    <div className="rounded-2xl border border-hairline bg-panel shadow-2xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        <span className="ml-2 font-mono text-xs text-quiet">variance run · exit 1</span>
      </div>
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6">
        <code>
          <span className="text-ivory">1 root(s): 0 authorized, 1 to review, 0 violation(s).</span>
          {"\n  "}
          <span className="text-orange">[needs-review]</span>
          <span className="text-ivory"> Button — Button</span>
          {"\n      "}
          <span className="text-quiet">undeclared component change: `Button` (token/paint) reached 1 subject(s)</span>
          {"\n      "}
          <span className="text-ivory underline decoration-orange/60 underline-offset-4">
            examples/readme-case/src/Button.js:9
          </span>
        </code>
      </pre>
    </div>
  );
}

const STAGES = [
  {
    stage: "detect",
    question: "Did anything move?",
    cost: "Almost nothing. A subject whose document digest equals its baseline's is settled without a render.",
  },
  {
    stage: "adjudicate",
    question: "Is the movement real, and is it this subject's?",
    cost: "One collection per changed subject — and never a paint.",
  },
  {
    stage: "attribute",
    question: "What caused it, and where is it written?",
    cost: "A fold over digests the run already produced, ending in a file:line.",
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
    when: "Your UI is ready in a Playwright test",
    how: "One package. Existing test and expect imports stay in place; add an observation.",
  },
  {
    pkg: "@variance-authority/storybook-collector",
    when: "You have a built or served Storybook",
    how: "The collector owns how a story becomes ready; the CLI owns baselines, reports, acceptance, and exit codes.",
  },
  {
    pkg: "@variance-authority/route-collector",
    when: "You have a running app or static build",
    how: "A route list or a sitemap. Each width becomes its own subject with its own baseline and verdict.",
  },
  {
    pkg: "@variance-authority/unit-test",
    when: "Your UI renders under jsdom",
    how: "Capture now, render later: the unit process writes a resource-closed archive; variance run paints it elsewhere.",
  },
];

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-6">
      {/* Nav */}
      <header className="flex items-center justify-between py-6">
        <a href="#" className="flex items-center gap-3">
          <Mark />
          <span className="text-sm font-medium tracking-[0.22em] text-ivory">
            VARIANCE&nbsp;AUTHORITY
          </span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-quiet">
          <a href="#integrate" className="hidden hover:text-ivory sm:inline">Integrate</a>
          <a href={`${GITHUB}/tree/main/docs`} className="hidden hover:text-ivory sm:inline">Docs</a>
          <a href={GITHUB} className="rounded-lg border border-hairline px-3 py-1.5 text-ivory hover:border-quiet">
            GitHub
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="pb-16 pt-14 sm:pt-20">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 font-mono text-xs text-quiet">
          <span className="h-1.5 w-1.5 rounded-full bg-orange" />
          0.0.0-beta · not on npm yet · first release publishes under the beta dist-tag
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-ivory sm:text-6xl">
          Visual regression with verifiable results.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-quiet">
          A padding token moves. Forty screenshots fail. The tool has found the visual
          change, but the next hour belongs to a reviewer. Variance Authority makes that
          investigation part of the run: it connects a changed region to the component
          that caused it and the <span className="font-mono text-[0.95em] text-ivory">file:line</span> where
          that component lives. The screenshot remains evidence; it stops being the whole
          answer.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a
            href={GITHUB}
            className="rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep shadow-lg shadow-orange/20 ring-1 ring-inset ring-white/20 hover:brightness-105"
          >
            Star on GitHub
          </a>
          <a
            href="#integrate"
            className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ivory hover:border-quiet"
          >
            See the integration
          </a>
        </div>
        <div className="mt-14">
          <Verdict />
        </div>
      </section>

      {/* Three stages */}
      <section className="border-t border-hairline py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-3xl">
          One change. One place to look.
        </h2>
        <p className="mt-4 max-w-2xl leading-7 text-quiet">
          Finding that something moved is the easy third of the job. The other two are
          deciding whether the movement is real, and saying what caused it — and in most
          of this category they are the reader&rsquo;s problem, handed over as a red
          rectangle. Here they are the run&rsquo;s problem, asked at the cheapest
          representation that can answer: structure and authored CSS before a browser,
          semantics under jsdom or Chromium, pixels only for differences that genuinely
          require rendering.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.stage} className="rounded-2xl border border-hairline bg-panel p-6">
              <p className="font-mono text-sm text-orange">{s.stage}</p>
              <p className="mt-2 font-semibold text-ivory">{s.question}</p>
              <p className="mt-3 text-sm leading-6 text-quiet">{s.cost}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Straight answers */}
      <section className="border-t border-hairline py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-3xl">
          Straight answers
        </h2>
        <p className="mt-4 max-w-2xl leading-7 text-quiet">
          Yes, visual regression is flaky. Anyone who says otherwise has either not run
          it at scale or has quietly set a threshold large enough to hide it. The design
          answer is to absorb each cause of variance by construction — and to say so
          plainly when a cause is absorbed by nothing.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {REFUSALS.map((r) => (
            <div key={r.title} className="rounded-2xl border border-hairline bg-panel p-6">
              <p className="font-semibold text-ivory">{r.title}</p>
              <p className="mt-3 text-sm leading-6 text-quiet">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Integration */}
      <section id="integrate" className="scroll-mt-8 border-t border-hairline py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-3xl">
          One package where your UI is already ready
        </h2>
        <p className="mt-4 max-w-2xl leading-7 text-quiet">
          No new way to write tests, no hosted setup. Pick the recipe that matches where
          your UI states already live.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {RECIPES.map((r) => (
            <div key={r.pkg} className="rounded-2xl border border-hairline bg-panel p-6">
              <p className="text-sm font-semibold text-ivory">{r.when}</p>
              <p className="mt-1 font-mono text-[13px] text-orange">{r.pkg}</p>
              <p className="mt-3 text-sm leading-6 text-quiet">{r.how}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="rounded-2xl border border-hairline bg-panel">
            <p className="border-b border-hairline px-5 py-2.5 font-mono text-xs text-quiet">
              cart.spec.ts — a Playwright suite, unchanged apart from the observation
            </p>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6 text-ivory">
              <code>{`import { test, expect } from '@playwright/test';
import { assertUnchanged, observe }
  from '@variance-authority/playwright-test';

test('the cart survives an empty basket', async ({ page }, testInfo) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Clear' }).click();

  const observation = await observe(page, page.getByTestId('cart'),
    testInfo, { subjectId: 'cart/empty' });

  assertUnchanged(observation);
});`}</code>
            </pre>
          </div>
          <div className="rounded-2xl border border-hairline bg-panel">
            <p className="border-b border-hairline px-5 py-2.5 font-mono text-xs text-quiet">
              the whole loop, for Storybook and route suites
            </p>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-7 text-ivory">
              <code>
                <span className="text-quiet">$</span> variance run{"\n"}
                <span className="text-quiet">$</span> variance report --format html{"\n"}
                <span className="text-quiet">$</span> variance accept story:checkout--empty{"\n"}
                <span className="text-quiet">$</span> variance run <span className="text-green"># exit 0</span>
              </code>
            </pre>
            <p className="border-t border-hairline px-5 py-4 text-sm leading-6 text-quiet">
              The first run reports every subject as{" "}
              <span className="font-mono text-[0.95em]">new</span> and exits 1 — a
              baseline nobody approved is not a pass. The report is one HTML file beside
              the JSON: no account, no upload step, nothing to keep running. Stabilization
              is on by default; animations are pinned, fonts and images waited for,
              scrollbars hidden, before anything is read.
            </p>
          </div>
        </div>
      </section>

      {/* Coming out of beta */}
      <section className="border-t border-hairline py-16">
        <div className="rounded-2xl border border-hairline bg-panel p-8 sm:p-10">
          <p className="font-mono text-sm text-orange">coming soon</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ivory">
            Out of beta, onto npm
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-quiet">
            Everything on this page ships in the repository today at{" "}
            <span className="font-mono">0.0.0-beta.1</span>, MIT-licensed. The{" "}
            <span className="font-mono">@variance-authority/*</span> packages are not on
            a registry yet; the first release publishes under the{" "}
            <span className="font-mono">beta</span> dist-tag, and an install line will
            appear here the day it can be true. Until then the repository builds from
            source, and watching it is the way to catch the release.
          </p>
          <a
            href={GITHUB}
            className="mt-6 inline-block rounded-lg bg-gradient-to-t from-fold to-orange px-5 py-2.5 text-sm font-semibold text-deep ring-1 ring-inset ring-white/20 hover:brightness-105"
          >
            Watch the repository
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-10 text-sm text-quiet">
        <div className="flex items-center gap-3">
          <Mark size={22} />
          <span>MIT · Copyright © 2026 Mechanic Garden</span>
        </div>
        <div className="flex items-center gap-6">
          <a href={`${GITHUB}/tree/main/docs`} className="hover:text-ivory">Docs</a>
          <a href={GITHUB} className="hover:text-ivory">GitHub</a>
        </div>
      </footer>
    </main>
  );
}
