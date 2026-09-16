import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { LexiconReport, RunReport, SubjectLexicon } from '@variance-authority/report';
import { locate } from './locate.js';
import { locateSubjects } from './locate.js';
import { orient } from './orient.js';
import { scopeLine, scopeOf } from './scope.js';

/**
 * A start point, asserted where it is load-bearing rather than where it is easy.
 *
 * The facts worth pinning are the ones a reader has to be able to trust without
 * measuring: that a start point is a place on disk and only that, that it is
 * matched literally, that it narrows rather than re-ranks, and that one naming
 * nowhere returns nothing rather than quietly returning the suite. Each test
 * below names the wrong answer it rules out.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

/** In `src/billing/`, and its own words never say the word `billing`. */
const INVOICE: SubjectLexicon = {
  subject: 'billing/invoice-table--overdue',
  boundaries: 4,
  terms: {
    example: ['InvoiceTable'],
    components: ['InvoiceTable', 'Badge'],
    files: ['src/billing/InvoiceTable.tsx', 'src/shared/Badge.tsx'],
    names: ['Invoices', 'Overdue'],
    text: ['Overdue'],
    roles: ['table', 'status'],
  },
};

/**
 * In `src/shipping/`, and it says `billing` out loud — a button labelled
 * *Billing* on a screen that is not the billing area. The decoy for the whole
 * idea: a start point read as a word would return this one.
 */
const DISPATCH: SubjectLexicon = {
  subject: 'shipping/dispatch-drawer--overdue',
  boundaries: 6,
  terms: {
    example: ['DispatchDrawer'],
    components: ['DispatchDrawer', 'Badge'],
    files: ['src/shipping/DispatchDrawer.tsx', 'src/shared/Badge.tsx'],
    names: ['Billing', 'Overdue'],
    text: ['Billing', 'Overdue'],
    roles: ['dialog', 'button', 'status'],
  },
};

/** Also in `src/billing/`, so the area is two subjects and not one. */
const STATEMENT: SubjectLexicon = {
  subject: 'billing/statement--paid',
  boundaries: 3,
  terms: {
    example: ['Statement'],
    components: ['Statement'],
    files: ['src/billing/Statement.tsx'],
    names: ['Statement'],
    roles: ['region'],
  },
};

const reportOf = (subjects: readonly SubjectLexicon[]): RunReport => {
  const lexicon: LexiconReport = {
    version: 1,
    fields: ['example', 'names', 'text', 'components', 'files', 'roles'],
    subjects: [...subjects],
  };
  return {
    runVersion: 1,
    at: '2026-09-16T00:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: subjects.map(({ subject }) => ({
      subject,
      verdict: 'unchanged' as const,
      because: 'same',
      changedPixels: 0,
      regions: [],
    })),
    notObserved: [],
    lexicon,
  };
};

const REPORT = reportOf([INVOICE, DISPATCH, STATEMENT]);

describe('a start point is a place on disk and nothing else', () => {
  it('names the area, not the screen with the area written on a button', () => {
    // `billing` is in DISPATCH's `names` and `text` and in the other two's ids
    // and files. A scope that searched what a subject shows would hold all
    // three, and the one it would be most confident about is the wrong one.
    const scope = scopeOf(REPORT, 'src/billing/');
    expect([...scope.subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
    ]);
  });

  it('rejects a start point this run holds no file at', () => {
    // Not an empty answer. The caller handed over a coordinate and the run does
    // not have it, which is a different fact from the place existing and
    // holding nothing.
    const scope = scopeOf(REPORT, 'warehousing');
    expect(scope.refused).toContain('not found');
    expect(scope.subjects.size).toBe(0);
  });

  it('rejects a component name that is nowhere on disk', () => {
    // `InvoiceTable` is a real component of a real subject. A component is not
    // a location, and nothing is looked up but locations.
    expect(scopeOf(REPORT, 'invoicetable-legacy').refused).toContain('not found');
  });

  it('rejects a filename, because a filename is not a path', () => {
    // Not because two packages have one. Because no file is at `Badge.tsx`.
    // The same answer comes back in a repository holding exactly one of them:
    // there is no file at that path, so there is nothing there.
    const two: readonly SubjectLexicon[] = [
      { subject: 'story:a', boundaries: 1, terms: { files: ['packages/web/Badge.tsx'] } },
      { subject: 'story:b', boundaries: 1, terms: { files: ['packages/admin/Badge.tsx'] } },
    ];
    for (const rows of [two, two.slice(0, 1)]) {
      const scope = scopeOf(reportOf(rows), 'Badge.tsx');
      expect(scope.refused).toContain('not found');
      expect(scope.subjects.size).toBe(0);
    }
    expect([...scopeOf(reportOf(two), 'packages/web/Badge.tsx').subjects]).toEqual(['story:a']);
  });

  it('does not read one recorded path as another because one ends with it', () => {
    // A run that recorded a file as the build host saw it recorded a different
    // path from the one the repository knows. Reading the shorter as the longer
    // is the same fragment rule under another name.
    const both: readonly SubjectLexicon[] = [
      { subject: 'story:a', boundaries: 1, terms: { files: ['src/billing/Card.tsx'] } },
      { subject: 'story:b', boundaries: 1, terms: { files: ['/build/42/src/billing/Card.tsx'] } },
    ];
    expect([...scopeOf(reportOf(both), 'src/billing/Card.tsx').subjects]).toEqual(['story:a']);
    expect([...scopeOf(reportOf(both), '/build/42/src/billing/Card.tsx').subjects]).toEqual([
      'story:b',
    ]);
  });

  it('rejects a wildcard anywhere but the last segment', () => {
    // A `*` in the middle is a pattern, and a pattern is not a path.
    const pages = reportOf([
      { subject: 'story:about', boundaries: 1, terms: { files: ['app/about-us/page.tsx'] } },
      { subject: 'story:contact', boundaries: 1, terms: { files: ['app/contact/page.tsx'] } },
    ]);
    expect(scopeOf(pages, 'app/*/page.tsx').refused).toContain('not found');
    expect(scopeOf(pages, 'app/ab*/page.tsx').refused).toContain('not found');
    expect(scopeOf(pages, '*').refused).toContain('not found');
  });

  it('does not fold case, because a path that differs in case does not exist', () => {
    const rows = reportOf([
      { subject: 'story:a', boundaries: 1, terms: { files: ['src/Billing/Card.tsx'] } },
    ]);
    expect(scopeOf(rows, 'src/billing/').refused).toContain('not found');
    expect([...scopeOf(rows, 'src/Billing/').subjects]).toEqual(['story:a']);
  });

  it('never answers a path from anything but the files a subject was seen in', () => {
    // `Badge` is a component of two subjects and a file of both. `InvoiceTable`
    // is a component of one and a file of one. Said as a path, only the file
    // answers — which is why a component shared by two cannot widen a scope.
    expect([...scopeOf(REPORT, 'src/billing/InvoiceTable.tsx').subjects]).toEqual([
      'billing/invoice-table--overdue',
    ]);
  });

  it('takes every path, because two paths are two entry points', () => {
    // Two entry points into one investigation are two places to be answered
    // from. The files common to both are very nearly always none, so keeping
    // only those would answer nothing where the caller was most specific.
    expect([...scopeOf(REPORT, 'src/billing/ src/shipping/').subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
      'shipping/dispatch-drawer--overdue',
    ]);
  });

  it('says which path named nowhere, rather than only that nothing did', () => {
    const scope = scopeOf(REPORT, 'src/billing/ src/warehousing/');
    expect(scope.subjects.size).toBe(0);
    expect(scope.unmatched).toEqual(['src/warehousing/']);
  });

  it('reads a path through the quotes it was copied inside', () => {
    expect([...scopeOf(REPORT, '"src/billing/",').subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
    ]);
  });

  it('rejects a stray word beside a good path instead of ignoring it', () => {
    // Skipping it would make a typo indistinguishable from a caller who meant
    // to narrow twice, and would answer a wider question than was asked.
    expect(scopeOf(REPORT, 'src/billing/ src/warehousing/').refused).toContain('not found');
  });
});

describe('what a start point does to an answer', () => {
  it('removes the subjects outside it', () => {
    const wide = locateSubjects(REPORT, 'overdue');
    const narrow = locateSubjects(REPORT, 'overdue', 'src/billing/');
    expect(wide.hits.map((hit) => hit.subject)).toContain('shipping/dispatch-drawer--overdue');
    expect(narrow.hits.map((hit) => hit.subject)).toEqual(['billing/invoice-table--overdue']);
  });

  it('counts rarity inside the scope, so the area is still the suite for a word', () => {
    // `overdue` is held by two of three subjects suite-wide and by one of two
    // inside billing. Both are counted against their own population, which is
    // the whole point: the number means *rare here*.
    const narrow = locateSubjects(REPORT, 'overdue', 'src/billing/');
    expect(narrow.scope?.subjects.size).toBe(2);
    expect(narrow.indexed).toBe(3);
  });

  it('answers nothing when it names nowhere, rather than answering the suite', () => {
    // The pond the caller named is empty, so the answer is empty. Falling back
    // to every other pond answers a question nobody asked, out of files they
    // ruled out — and does it while printing a confident top hit.
    const missed = locateSubjects(REPORT, 'overdue', 'src/warehousing/');
    expect(missed.hits).toEqual([]);
    expect(missed.scope?.subjects.size).toBe(0);
  });

  it('answers nothing when the start point was not a place at all', () => {
    expect(locateSubjects(REPORT, 'overdue', 'warehousing').hits).toEqual([]);
  });

  it('prints the scope it searched, with its size', () => {
    const answer = locate.run(REPORT, { query: 'overdue', from: 'src/billing/' });
    expect(answer).toContain('Searched 2 of 3 subject(s)');
  });

  it('prints why a start point this run holds no file at searched nothing', () => {
    const answer = locate.run(REPORT, { query: 'overdue', from: 'src/warehousing/' });
    expect(answer).toContain('No search was run');
    expect(answer).toContain('`src/warehousing/` is not found');
    expect(answer).toContain('leave the start point out');
  });

  it('is absent from the answer when none was given', () => {
    expect(locate.run(REPORT, { query: 'overdue' })).not.toContain('Searched');
  });
});

describe('a start point reaches the arrangement too', () => {
  /** Landmarks on both areas, the same words in the same arrangement. */
  const LAID = reportOf([
    {
      ...INVOICE,
      landmarks: [
        { role: 'table', name: 'Invoices', box: [0, 0, 400, 200], file: 'src/billing/InvoiceTable.tsx', line: 12 },
        { role: 'cell', name: 'Amount', within: 0, box: [0, 40, 120, 20] },
        { role: 'status', text: 'Overdue', within: 0, box: [0, 64, 120, 20], file: 'src/billing/InvoiceTable.tsx', line: 41 },
      ],
    },
    {
      ...DISPATCH,
      landmarks: [
        { role: 'dialog', name: 'Billing', box: [0, 0, 400, 200], file: 'src/shipping/DispatchDrawer.tsx', line: 8 },
        { role: 'cell', name: 'Amount', within: 0, box: [0, 40, 120, 20] },
        { role: 'status', text: 'Overdue', within: 0, box: [0, 64, 120, 20], file: 'src/shipping/DispatchDrawer.tsx', line: 33 },
      ],
    },
  ]);

  it('answers from the area asked for, not from the identical decoy', () => {
    // Both surfaces put `Overdue` beneath `Amount`, pixel for pixel. Nothing in
    // the words or the arrangement separates them; only the start point does.
    const both = orient(LAID, 'the overdue under the amount');
    expect(both.hits.length).toBe(2);

    const one = orient(LAID, 'the overdue under the amount', 'src/billing/');
    expect(one.hits.map((hit) => hit.subject)).toEqual(['billing/invoice-table--overdue']);
  });

  it('never reads a surface the start point removed', () => {
    // `considered` counts surfaces walked in full. Dropping them before the
    // filters is the difference between narrowing and filtering afterwards.
    expect(orient(LAID, 'the overdue under the amount', 'src/billing/').considered).toBe(1);
  });
});

/**
 * The way a real application defeated a start point: a filename lending a word
 * it never meant.
 *
 * Measured on a 2019 application of 166 subjects, asking after the forty
 * directories its files name. Whole-segment matching took precision from 87.5%
 * to 97.3% with recall unmoved at 100%, and grounding the start point in a file
 * rather than a name was worth a further 5.7 points on the top hit.
 */
describe('a path is matched literally, segment for whole segment', () => {
  /** Under `src/components/`, with a name ending in the word `Page`. */
  const FOOTER: SubjectLexicon = {
    subject: 'story:footer-for-payment',
    boundaries: 2,
    terms: { files: ['src/components/FooterForPaymentPage/FooterForPaymentPage.tsx'], names: ['Pay'] },
  };
  /** Genuinely under `src/pages/`, and declared as a component of that name. */
  const ACTIVITY: SubjectLexicon = {
    subject: 'story:activity',
    boundaries: 2,
    terms: { files: ['src/pages/Activity/Activity.tsx'], components: ['Activity'], names: ['Activity'] },
  };
  const APP = reportOf([FOOTER, ACTIVITY]);

  it('does not answer a folder with a file whose name merely holds it', () => {
    expect([...scopeOf(APP, 'src/pages/').subjects]).toEqual(['story:activity']);
  });

  it('does not stem a segment, because a coordinate was not a guess', () => {
    // `page` is not `pages`. A caller who typed the folder they are standing in
    // did not ask to be taken to its neighbour.
    expect(scopeOf(APP, 'src/page/').subjects.size).toBe(0);
  });

  it('does not drop an extension, because two files may differ only there', () => {
    expect(scopeOf(APP, 'src/pages/Activity/Activity.ts').subjects.size).toBe(0);
    expect([...scopeOf(APP, 'src/pages/Activity/Activity.tsx').subjects]).toEqual(['story:activity']);
  });

  it('reads a build host`s own directories only when they are said as a path', () => {
    const built: SubjectLexicon = {
      subject: 'story:card',
      boundaries: 2,
      terms: { files: ['/Users/somebody/checkout/src/Card.tsx'], names: ['Card'] },
    };
    const ran = reportOf([built]);
    expect(scopeOf(ran, 'checkout/src/').refused).toContain('not found');
    expect([...scopeOf(ran, '/Users/somebody/checkout/src/').subjects]).toEqual(['story:card']);
  });
});

describe('a start point is grounded in a file, at whatever width the caller has', () => {
  const PAGE: SubjectLexicon = {
    subject: 'story:about-page',
    boundaries: 2,
    terms: { files: ['app/about-us/page.tsx'], names: ['About us'] },
  };
  const LAYOUT: SubjectLexicon = {
    subject: 'story:about-layout',
    boundaries: 2,
    terms: { files: ['app/about-us/layout.tsx'], names: ['Shell'] },
  };
  const OTHER: SubjectLexicon = {
    subject: 'story:contact',
    boundaries: 2,
    terms: { files: ['app/contact/page.tsx'], names: ['Contact'] },
  };
  /** A route nested below the folder, which only the recursive width reaches. */
  const NESTED: SubjectLexicon = {
    subject: 'story:about-team',
    boundaries: 2,
    terms: { files: ['app/about-us/team/page.tsx'], names: ['The team'] },
  };
  const APP = reportOf([PAGE, LAYOUT, OTHER, NESTED]);

  it('the file itself names only what that file shows', () => {
    expect([...scopeOf(APP, 'app/about-us/page.tsx').subjects]).toEqual(['story:about-page']);
  });

  it('a trailing wildcard is the files of that folder and nothing deeper', () => {
    expect([...scopeOf(APP, 'app/about-us/*').subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
    ]);
    expect([...scopeOf(APP, 'app/*').subjects]).toEqual([]);
  });

  it('the folder alone is everything underneath it', () => {
    expect([...scopeOf(APP, 'app/about-us/').subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
      'story:about-team',
    ]);
    expect([...scopeOf(APP, 'app/').subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
      'story:about-team',
      'story:contact',
    ]);
  });

  it('answers an absolute path only when the run recorded it absolutely', () => {
    // These files were recorded relative to the repository, so the absolute
    // path an editor hands over is a path this run holds nothing at.
    expect(scopeOf(APP, '/Users/somebody/site/app/about-us/*').refused).toContain('not found');
  });
});

describe('an empty scope says what was looked for and where', () => {
  it('names the path this run holds no file at', () => {
    const line = scopeLine(scopeOf(REPORT, 'src/warehousing/'), 3);
    expect(line).toContain('`src/warehousing/` is not found');
    expect(line).toContain('leave the start point out');
  });

  it('names every path when one of several is not there', () => {
    const line = scopeLine(scopeOf(REPORT, 'src/billing/ src/warehousing/'), 3);
    expect(line).toContain('`src/warehousing/` is not found');
    expect(line).not.toContain('`src/billing/` is not found');
  });
});
