import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storybookCollector } from '@variance-authority/storybook-collector';

/**
 * `collectAlone`, against the thing it exists to tell apart from a regression.
 *
 * The saving this tool is built on is that the world is not rebuilt between
 * subjects: one browser, one page, one Storybook, for a whole run (ADR-0009).
 * What it buys is the possibility that story B renders differently because story
 * A ran first — and the comparison cannot tell that apart from an edit, because
 * both arrive as *the pixels moved*.
 *
 * `Sheet — left in the document` is a real story that appends a rule to the
 * document and never removes it. Nothing about it is a test double: it is built
 * by Storybook into the same `storybook-static` every other case test reads, and
 * it is excluded from the run by a tag rather than by being hidden.
 *
 * Two halves, and only one of them is interesting:
 *
 * - **a clean subject reads the same alone as it does in company.** Without
 *   this, `collectAlone` could return a fresh reading that differs from the
 *   shared one for a reason that has nothing to do with what else ran — a moved
 *   asset URL, a different viewport, a source index that was not carried — and
 *   every subject would look order-dependent.
 * - **a polluted subject does not.** This is the product. A test that only
 *   exercised the half above would still pass if `collectAlone` were `collect`
 *   under another name.
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
    '\ncases/storybook-case (alone): skipped.' +
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

/**
 * The subject, and the story that ruins it.
 *
 * `Card — with actions` is chosen because it renders two `Button`s and declares
 * no `letter-spacing` on them, so the leaked rule reaches it and changes its
 * layout rather than being overridden by an inline declaration.
 */
const CARD = { subject: { id: 'story:case-surface--card-with-actions', kind: 'story' } };
const LEAK = { subject: { id: 'story:case-surface--leaks-a-sheet', kind: 'story' } };

let collector;
/** The card before anything else ran, read twice, to separate two failures. */
let clean;
let repeated;
/** The same card, out of a world nothing else has touched, while the page is clean. */
let aloneBefore;
/** The same card again, after the leaking story has been through the page. */
let polluted;
/** And once more alone, after the pollution — the reading the verdict rests on. */
let aloneAfter;

beforeAll(async () => {
  if (!READY) return;

  // The real options, not a reduced set. `source` is here because a source index
  // is one of the inputs an isolated reading has to reproduce, and a test that
  // switched it off would not notice it being dropped.
  collector = await storybookCollector({ source: { dirs: ['cases/storybook-case/src'] } })({
    config: CONFIG,
  });

  clean = await collector.collect(CARD);
  repeated = await collector.collect(CARD);
  aloneBefore = await collector.collectAlone(CARD);

  await collector.collect(LEAK);

  polluted = await collector.collect(CARD);
  aloneAfter = await collector.collectAlone(CARD);
}, 240_000);

afterAll(async () => {
  await collector?.close();
});

const live = READY ? describe : describe.skip;

live('a subject nothing has touched', () => {
  it('reads the same twice in the same page', () => {
    // The premise, asserted rather than assumed. If a story read twice in one
    // page already differs, every other assertion in this file is measuring
    // that instead of what it says it measures — and the two failures look
    // identical from the outside.
    expect(clean.ok, clean.because).toBe(true);
    expect(repeated).toEqual(clean);
  });

  it('reads the same alone as it does in company', () => {
    // Everything except isolation held identical: the same viewport, the same
    // fonts, the same ready selectors, the same source index, and — the one that
    // is easy to get wrong — the same static server, so every asset URL and
    // therefore the environment key is the one the shared world produced. A
    // second server on a second port moves all of them, and the clean collection
    // comes back `incomparable` instead of settling anything.
    expect(aloneBefore.ok, aloneBefore.because).toBe(true);
    expect(aloneBefore).toEqual(clean);
  });
});

live('a subject an earlier story polluted', () => {
  it('reads differently in the page that story ran in', () => {
    // The premise of the half below, and worth failing separately: if the leak
    // stopped reaching the card — an inline declaration added to `Button`, a
    // Storybook that started resetting the document between stories — the
    // isolation assertion would go green while proving nothing at all.
    expect(polluted.ok, polluted.because).toBe(true);
    expect(polluted).not.toEqual(clean);
    expect(JSON.stringify(polluted.document)).toContain('0.35em');
    expect(JSON.stringify(clean.document)).not.toContain('0.35em');
  });

  it('reads clean again in a world nothing else has touched', () => {
    // The whole product. The page says this subject changed; the clean world
    // says it did not. That is the difference between `changed` — which asks a
    // person to accept a new baseline — and `order-dependent`, which names the
    // story that moved it and refuses to record anything.
    expect(aloneAfter.ok, aloneAfter.because).toBe(true);
    expect(aloneAfter).not.toEqual(polluted);
    expect(aloneAfter).toEqual(clean);
    expect(JSON.stringify(aloneAfter.document)).not.toContain('0.35em');
  });
});
