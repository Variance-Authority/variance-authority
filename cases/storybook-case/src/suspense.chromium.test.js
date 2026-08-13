import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { storybookCollector } from '@variance-authority/storybook-collector';

/**
 * The decision a Suspense boundary forces, run through the shipped collector.
 *
 * `cli.chromium.test.js` proves the cycle is green *with* these stories in it,
 * which it can only do because the never-resolving one is declared a loading
 * capture in `collector/index.mjs`. That leaves the more important half unproved:
 * what happens to the same story when nobody declared it. This file runs the
 * real collector over the real build twice — once with the declaration and once
 * without — because the two configurations are the whole feature, and a case
 * that only ever exercises the green one is a case that would still pass if the
 * refusal had been deleted.
 *
 * Three properties, one per story:
 *
 * - **a boundary that resolves is waited for.** Nothing about `SuspendedRoster`
 *   is declared anywhere. Storybook says the story rendered — correctly, the
 *   story function returned — and the component behind the boundary does not
 *   exist yet. No `readySelector` could help: a component that suspends renders
 *   no markup to hang a marker on.
 * - **a boundary inside a boundary is waited for too.** One clean reading is not
 *   enough, and this is the story that says so.
 * - **a boundary that never resolves is refused by name**, and the refusal says
 *   what it is (a flake source), which component wrote the boundary, and the two
 *   things a person can do about it.
 *
 * Skipped, loudly, without a build or a browser.
 */

const ROOT = join(process.cwd(), 'cases', 'storybook-case');
const INDEX = join(ROOT, 'storybook-static', 'index.json');

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const READY = existsSync(INDEX) && BROWSER_AVAILABLE;

if (!READY) {
  console.warn(
    '\ncases/storybook-case (suspense): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(INDEX)
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook') +
      '\n',
  );
}

const CONFIG = {
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
  subjects: { index: INDEX },
};

/** One collector per configuration, closed by `afterAll` whatever the assertions do. */
const open = [];

async function collectorWith(options) {
  const collector = await storybookCollector(options)({ config: CONFIG });
  open.push(collector);
  return collector;
}

function collectStory(collector, id) {
  return collector.collect({ subject: { id: `story:${id}`, kind: 'story' } });
}

afterAll(async () => {
  for (const collector of open) await collector.close();
});

const live = READY ? describe : describe.skip;

live('waiting for a boundary nobody declared', () => {
  it('captures the component behind a boundary that resolves', async () => {
    // The plain case, and the one that has no other answer. `storyRendered` has
    // already fired when this runs — the story function returned, and what is on
    // screen is the fallback. Every marker-shaped mechanism is unavailable
    // because the component that would carry the marker has not rendered.
    const collector = await collectorWith({ network: false });
    const result = await collectStory(collector, 'case-surface--suspense-settles');

    expect(result.ok, result.because).toBe(true);

    const markup = JSON.stringify(result.document);
    expect(markup).toContain('Grace');
    expect(markup).not.toContain('loading roster');
  }, 120_000);

  it('waits again for a boundary that only appears once the first one resolves', async () => {
    // The waterfall. At the moment the outer promise settles the tree holds one
    // boundary and it is showing children, so a wait that returned on the first
    // clean reading would stop exactly there — and React would then commit the
    // children, mount `Invoice`, and reveal an inner boundary already showing
    // "loading lines…". The capture would be of a skeleton on the machines where
    // the timing lands that way and of the component on the others, which is the
    // flake this whole mechanism exists to end.
    const collector = await collectorWith({ network: false });
    const result = await collectStory(collector, 'case-surface--suspense-waterfall');

    expect(result.ok, result.because).toBe(true);

    const markup = JSON.stringify(result.document);
    expect(markup).toContain('Invoice #4021');
    expect(markup).toContain('Handover');
    expect(markup).not.toContain('loading lines');
  }, 120_000);
});

live('a boundary that never resolves', () => {
  it('refuses it as a flake source, and names what is waiting', async () => {
    // No `loading` declaration, which is the configuration every adopter starts
    // in. The refusal has to carry enough to act on: that this is a flake rather
    // than a failure, which boundary is open, which component wrote it, and the
    // two things a person can do — fix the promise, or say the skeleton is the
    // subject. A refusal reading "timed out" would leave all four to guesswork.
    const collector = await collectorWith({ network: false, suspenseTimeoutMs: 500 });
    const result = await collectStory(collector, 'case-surface--suspense-stalled');

    expect(result.ok).toBe(false);
    expect(result.because).toContain('flake source');
    expect(result.because).toContain('story:case-surface--suspense-stalled');
    expect(result.because).toContain('Suspense');
    expect(result.because).toContain('StalledFeed');
    expect(result.because).toContain('declare this subject as a loading-state capture');
  }, 120_000);

  it('captures the fallback when the run declares that is the subject', async () => {
    // The escape hatch, and the only one — the same story, the same page, one
    // line of configuration different. What comes back is a real observation
    // over the skeleton, which is what makes it a baseline somebody can review
    // rather than an exception somebody suppresses.
    const collector = await collectorWith({
      network: false,
      loading: ['case-surface--suspense-stalled'],
    });
    const result = await collectStory(collector, 'case-surface--suspense-stalled');

    expect(result.ok, result.because).toBe(true);
    expect(JSON.stringify(result.document)).toContain('loading feed');
  }, 120_000);

  it('refuses a declaration whose subject settles, too', async () => {
    // Checked in both directions, because a declaration that outlived its
    // subject is the same nondeterminism arriving from the other side: what gets
    // recorded then depends on how fast the machine is.
    //
    // The marker is here to make the assertion deterministic rather than to make
    // the point — a declared loading capture waits for nothing, so without it
    // this story is genuinely still pending at read time on a slow machine and
    // genuinely settled on a fast one, which is the flake itself and not
    // something to assert against.
    const collector = await collectorWith({
      network: false,
      ready: { 'case-surface--suspense-settles': '[data-testid="suspense-ready"]' },
      loading: ['case-surface--suspense-settles'],
    });
    const result = await collectStory(collector, 'case-surface--suspense-settles');

    expect(result.ok).toBe(false);
    expect(result.because).toContain('declared as a loading-state capture');
    expect(result.because).toContain('had resolved');
  }, 120_000);
});

// Top level on purpose: `live` is `describe.skip` without a build or a browser,
// and a todo inside a skipped block is counted as skipped rather than as a gap.

it.todo(
  'the same three properties over a Suspense tree that hydrates — a boundary whose `dehydrated` field is set is showing server markup rather than a fallback, so it reads as pending and is refused, and the refusal should say `awaiting hydration` instead of naming a promise — needs an SSR case, which no case in this repository is (spec 0021)',
);
