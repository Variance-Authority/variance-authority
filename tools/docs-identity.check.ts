import { describe, expect, it } from 'vitest';
import { MARKDOWN, flat } from './markdown.js';

/**
 * Who may say what the product is, and who has to say what they are.
 *
 * Both rules here exist because one paragraph defining the whole product was
 * pasted onto twenty-two pages at once, standing in for each page's own
 * subject: pages about searching a run, about reading eight languages, about
 * publishing a package, all opening by saying the product is a visual
 * regression system. A reader who lands on one of those is told about some
 * other page. The first paragraph is also the page's meta description and its
 * `llms.txt` line, so the paste was the machine-readable definition of this
 * project, twenty-two times over.
 *
 * Both rules match `flat`, never the file. Every page here is hard-wrapped, so
 * a sentence a reader hears as one phrase is three lines on disk, and a rule
 * written against the file finds a fraction of what it looks for — the paste
 * above was first counted at one page out of twenty-two that way.
 */

/** Published prose. A contributor note or a generated changelog answers to nobody. */
const PAGES = MARKDOWN.filter(
  (file) =>
    !/^docs\/context\/|^backlog\/|(^|\/)CHANGELOG\.md$/.test(file) &&
    file !== 'docs/AGENTS.md' &&
    file !== 'docs/visual-guidelines.md',
);

/** The one page whose subject is the product. */
const OVERVIEW = 'docs/README.md';

/**
 * Saying what Variance Authority *is*, as against what it does on the page's
 * own subject. The verb has to attach to the name: `Variance Authority runs
 * that comparison in your own build job` is a page describing its own topic,
 * and `Variance Authority's file gate is a…` is a page describing one part.
 * `Variance Authority is a visual regression system` belongs on one page.
 */
const IDENTITY = /\bVariance Authority\s+(?:also\s+|still\s+|really\s+)?(?:is|was|remains)\s+(?:a|an|the|not)\b/i;

describe('only the overview says what the product is', () => {
  for (const file of PAGES.filter((file) => file !== OVERVIEW)) {
    it(file, () => {
      const found = IDENTITY.exec(flat(file));
      expect(
        found?.[0] ?? null,
        `${file} says what Variance Authority is. Only ${OVERVIEW} does that. Say what this page is about, and link the name.`,
      ).toBeNull();
    });
  }
});

/**
 * Sentences carried by more than a few pages on purpose. A coined term has to
 * be landed by whichever page a reader arrives on, so the one-line gloss of
 * `subject` travels with it; the platform note travels with the one package
 * that ships per-platform binaries. A definition of the product is not one of
 * these, and the way to add one is to be able to say why a reader benefits
 * from meeting it twice.
 */
const SHARED_BY_DESIGN = [
  /^a subject is one named ui state you asked for/,
  /^(?:src\/a\/file\.ts|key what it decides|viewport width and height|retention durable|the hash is of the font|required even with no history|the project-relative test file)/,
  /^it names one of these packages per platform|^the scanner it carries is an acceleration|^a machine that does not get a binary/,
];

/** How many pages may carry one sentence before it was written for none of them. */
const PASTE_LIMIT = 3;

describe('no paragraph stands in for a page', () => {
  const homes = new Map<string, Set<string>>();

  for (const file of PAGES) {
    for (const raw of flat(file).split(/(?<=[.:!?])\s+/)) {
      const sentence = raw.trim().toLowerCase();
      if (sentence.split(' ').length < 12) continue;
      homes.set(sentence, (homes.get(sentence) ?? new Set()).add(file));
    }
  }

  const pasted = [...homes]
    .filter(([, files]) => files.size > PASTE_LIMIT)
    .filter(([sentence]) => !SHARED_BY_DESIGN.some((allowed) => allowed.test(sentence)));

  it(`no sentence appears on more than ${PASTE_LIMIT} pages`, () => {
    expect(
      pasted.map(([sentence, files]) => `${files.size}x "${sentence.slice(0, 90)}…"`),
      'A sentence on many pages is a sentence written for none of them. Say what this page is about instead.',
    ).toEqual([]);
  });
});
