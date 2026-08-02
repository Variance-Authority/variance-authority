import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareLocales, normalize, type SemanticSnapshot } from '@variance-authority/core';
import { createHarness, type Harness } from '@variance-authority/playwright';
// @ts-expect-error — a plain .mjs script, deliberately not part of the TS build.
import { stale } from '../scripts/bundle.mjs';

/**
 * One panel, two languages, one browser.
 *
 * The head-to-head next door asks whether a *change* was reported. This asks the
 * question a localized product actually has, which is not a change at all: two
 * renders, both correct, differing only in language. A comparison of images can
 * be pointed at it and will answer "these two pictures differ", which is true
 * and useless — the panel is *supposed* to differ. What it cannot say is which
 * string failed to get translated, because a PNG has no strings, and it cannot
 * say which box stopped fitting, because it has no boxes either.
 *
 * Both answers are arithmetic once the document is the artifact, and both are
 * measured here against real Chromium layout rather than declared rects.
 *
 * **What is not measured.** The incumbent was not run at two locales. What their
 * answer would cost — a baseline per locale per subject, so storage and review
 * both multiply by the number of languages — follows from how `toHaveScreenshot`
 * is keyed and is stated in `README.md` as an argument, not as a measurement.
 */

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE_URL = pathToFileURL(join(PACKAGE_ROOT, 'page', 'case.html')).href;
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'case.js');

const VIEWPORT = { width: 900, height: 700, deviceScaleFactor: 1, colorScheme: 'light' } as const;

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const STALE = stale();
const READY = BROWSER_AVAILABLE && existsSync(BUNDLE) && STALE === null;

let harness: Harness | undefined;
let english: SemanticSnapshot;
let german: SemanticSnapshot;
/** The same panel in a 300px sidebar, where whether German fits is a live question. */
let narrowEnglish: SemanticSnapshot;
let narrowGerman: SemanticSnapshot;

beforeAll(async () => {
  if (!READY) return;

  harness = await createHarness({
    url: PAGE_URL,
    bundle: readFileSync(BUNDLE, 'utf8'),
    viewport: VIEWPORT,
    fonts: ['ui-sans-serif/400/normal/incumbent-case'],
  });

  // The same scenario id both arms use, at its unedited side. Nothing about the
  // eight scenarios is exercised here — only the message catalogue moves.
  english = normalize(await harness.capture('label-dropped', 'before'));
  german = normalize(await harness.capture('label-dropped', 'before@de'));
  narrowEnglish = normalize(await harness.capture('label-dropped', 'before@en@300'));
  narrowGerman = normalize(await harness.capture('label-dropped', 'before@de@300'));
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

const live = READY ? describe : describe.skip;

if (!READY) {
  console.warn(
    '\ncases/incumbent-case (locale): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(BUNDLE) ? '' : '\n  no page bundle') +
      (STALE === null ? '' : `\n  ${STALE}`) +
      '\n  yarn workspace @variance-authority/case-incumbent incumbent\n',
  );
}

live('one panel, two languages', () => {
  it('measures the layout it is judging, rather than declaring it', () => {
    // The rects come from Chromium. Every other assertion in this file rests on
    // that, and a snapshot with no layout would make the overflow answer vacuous
    // rather than negative.
    const result = compareLocales(english, german, { base: 'en', other: 'de' });

    expect(result.layoutObserved).toBe(true);
    expect(result.translated).toBeGreaterThan(0);
  });

  /**
   * The finding that corrected the rule.
   *
   * The first run of this test reported **nothing**, because the only string
   * left in English is the indicator's `title` and the rule was reading text
   * nodes only. In a real product the strings that get forgotten are exactly the
   * ones that are not text nodes — an `aria-label` on an icon button, a
   * `placeholder`, an `alt`. They render no pixel of their own, which is both
   * why they are forgotten and why no image comparison at any tolerance has ever
   * reported one.
   */
  it('names the string nobody translated, including the one that is not text', () => {
    const result = compareLocales(english, german, { base: 'en', other: 'de' });
    const untranslated = result.findings.filter((finding) => finding.rule === 'untranslated');

    expect(untranslated.map((finding) => finding.what).join('\n')).toContain('Unsaved changes');
    expect(untranslated.every((finding) => finding.band === 'content')).toBe(true);
  });

  it('finds the box that stopped fitting, and whose it is', () => {
    const wide = compareLocales(english, german, { base: 'en', other: 'de' });
    const narrow = compareLocales(narrowEnglish, narrowGerman, { base: 'en', other: 'de' });

    const overflows = (result: typeof wide) =>
      result.findings.filter((finding) => finding.rule === 'overflows-container');

    console.log(
      [
        '',
        '--- one panel, en → de (real Chromium layout)',
        `  translated strings   ${wide.translated}`,
        `  identical strings    ${wide.identical}`,
        `  widest growth        ${wide.expansion?.ratio.toFixed(2)}× at ${
          wide.expansion?.component ?? wide.expansion?.path
        }`,
        `  overflows at 420px   ${overflows(wide).length}`,
        `  overflows at 300px   ${overflows(narrow).length}`,
        ...[...wide.findings, ...overflows(narrow)].map(
          (finding) =>
            `    [${finding.rule}] ${finding.what}` +
            (finding.component !== undefined ? ` — ${finding.component}` : ''),
        ),
        '',
      ].join('\n'),
    );

    // Two widths, because the first prediction was wrong and the correction is
    // the interesting part. `Zugänglichkeitsüberprüfung` is one word and cannot
    // be broken, so a flex row cannot shrink below it — but at 420px there is
    // room and nothing overflows. The panel that ships in a 300px sidebar is
    // where the question is live. "Does German fit" is not a property of a
    // translation; it is a property of a translation *and* a container, which is
    // exactly why a ratio threshold cannot answer it and two rectangles can.
    expect(overflows(wide)).toEqual([]);
    expect(overflows(narrow).length).toBeGreaterThan(0);
    expect(overflows(narrow).every((finding) => finding.band === 'geometry')).toBe(true);
    expect(overflows(narrow)[0]?.what).toContain('fitted in en');
  });

  it('says nothing about a locale compared with itself', () => {
    const result = compareLocales(english, english, { base: 'en', other: 'en' });

    expect(result.translated).toBe(0);
    expect(result.findings).toEqual([]);
  });
});
