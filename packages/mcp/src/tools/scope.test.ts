import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { LexiconReport, RunReport, SubjectLexicon } from '@variance-authority/report';
import { locate } from './locate.js';
import { locateSubjects } from './locate.js';
import { orient } from './orient.js';
import { PLACE_FIELDS, scopeOf } from './scope.js';

/**
 * A start point, asserted where it is load-bearing rather than where it is easy.
 *
 * The three facts worth pinning are the ones a reader has to be able to trust
 * without measuring: that a start point is matched against where code is and
 * never against what a subject shows, that it narrows rather than re-ranks, and
 * that one naming nowhere fails visibly and changes nothing. Each test below
 * names the wrong answer it rules out.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

/** In `billing/`, and its own words never say the word `billing`. */
const INVOICE: SubjectLexicon = {
  subject: 'billing/invoice-table--overdue',
  boundaries: 4,
  terms: {
    example: ['InvoiceTable'],
    components: ['InvoiceTable', 'Badge'],
    files: ['src/billing/InvoiceTable.tsx'],
    names: ['Invoices', 'Overdue'],
    text: ['Overdue'],
    roles: ['table', 'status'],
  },
};

/**
 * In `shipping/`, and it says `billing` out loud — a button labelled *Billing*
 * on a screen that is not the billing area. The decoy for the whole idea: a
 * start point that read `text` would return this one.
 */
const DISPATCH: SubjectLexicon = {
  subject: 'shipping/dispatch-drawer--overdue',
  boundaries: 6,
  terms: {
    example: ['DispatchDrawer'],
    components: ['DispatchDrawer', 'Badge'],
    files: ['src/shipping/DispatchDrawer.tsx'],
    names: ['Billing', 'Overdue'],
    text: ['Billing', 'Overdue'],
    roles: ['dialog', 'button', 'status'],
  },
};

/** Also in `billing/`, so the area is two subjects and not one. */
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

describe('a start point is a place and not a thing', () => {
  it('names the area, not the screen with the area written on a button', () => {
    // `billing` is in DISPATCH's `names` and `text` and in the other two's ids
    // and files. A scope that searched what a subject shows would hold all
    // three, and the one it would be most confident about is the wrong one.
    const scope = scopeOf(REPORT, 'billing');
    expect([...scope.subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
    ]);
  });

  it('reads only the fields that say where code is', () => {
    expect([...PLACE_FIELDS].sort()).toEqual([
      'components',
      'createdBy',
      'example',
      'files',
      'id',
      'regions',
    ]);
  });

  it('takes every word, because two words are a caller narrowing on purpose', () => {
    // `Badge` is in billing and in shipping; `billing` is in billing alone.
    // Either word alone holds two subjects; together they hold the one.
    expect([...scopeOf(REPORT, 'billing badge').subjects]).toEqual(['billing/invoice-table--overdue']);
  });

  it('says which word named nowhere, rather than only that nothing did', () => {
    const scope = scopeOf(REPORT, 'billing warehousing');
    expect(scope.subjects.size).toBe(0);
    expect(scope.unmatched).toEqual(['warehousing']);
  });

  it('is not emptied by punctuation the caller left in', () => {
    // `--` carries no letter or digit, so it narrows nothing on purpose and is
    // skipped. Treated as a word that named nowhere it would empty the scope,
    // which would make a stray dash indistinguishable from a wrong area.
    expect(scopeOf(REPORT, 'billing --').subjects.size).toBe(2);
  });
});

describe('what a start point does to an answer', () => {
  it('removes the subjects outside it', () => {
    const wide = locateSubjects(REPORT, 'overdue');
    const narrow = locateSubjects(REPORT, 'overdue', 'billing');
    expect(wide.hits.map((hit) => hit.subject)).toContain('shipping/dispatch-drawer--overdue');
    expect(narrow.hits.map((hit) => hit.subject)).toEqual(['billing/invoice-table--overdue']);
  });

  it('counts rarity inside the scope, so the area is still the suite for a word', () => {
    // `overdue` is held by two of three subjects suite-wide and by one of two
    // inside billing. Both are counted against their own population, which is
    // the whole point: the number means *rare here*.
    const narrow = locateSubjects(REPORT, 'overdue', 'billing');
    expect(narrow.scope?.subjects.size).toBe(2);
    expect(narrow.indexed).toBe(3);
  });

  it('changes nothing when it names nowhere, and says so', () => {
    const missed = locateSubjects(REPORT, 'overdue', 'warehousing');
    const wide = locateSubjects(REPORT, 'overdue');
    expect(missed.hits.map((hit) => hit.subject)).toEqual(wide.hits.map((hit) => hit.subject));
    expect(missed.scope?.subjects.size).toBe(0);
  });

  it('prints the scope it searched, with its size', () => {
    const answer = locate.run(REPORT, { query: 'overdue', from: 'billing' });
    expect(answer).toContain('Searched 2 of 3 subject(s), those `billing` names.');
  });

  it('prints why a start point that named nowhere scoped nothing', () => {
    const answer = locate.run(REPORT, { query: 'overdue', from: 'warehousing' });
    expect(answer).toContain('names no subject of 3');
    expect(answer).toContain('`warehousing` names no id, component, creator, file or region');
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

    const one = orient(LAID, 'the overdue under the amount', 'billing');
    expect(one.hits.map((hit) => hit.subject)).toEqual(['billing/invoice-table--overdue']);
  });

  it('never reads a surface the start point removed', () => {
    // `considered` counts surfaces walked in full. Dropping them before the
    // filters is the difference between narrowing and filtering afterwards.
    expect(orient(LAID, 'the overdue under the amount', 'billing').considered).toBe(1);
  });
});

/**
 * The way a real application defeated a start point: a filename lending a word
 * it never meant.
 *
 * Measured on a 2019 application of 166 subjects, asking after the forty
 * directories its files name. Whole-segment matching took precision from 87.5%
 * to 97.3% with recall unmoved at 100%, and what precision remains against is
 * components genuinely named after their place rather than files misread.
 *
 * Only `files` is read this way. A component name is not a path and a start
 * point may well be one — `DispatchDrawer` is the dispatch drawer — so the
 * name fields stay as generous as they were.
 */
describe('a word names what the code declares, never a path', () => {
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

  it('does not answer a word with a file whose name merely holds it', () => {
    expect(scopeOf(APP, 'pages').subjects.size).toBe(0);
    expect(scopeOf(APP, 'page').subjects.size).toBe(0);
  });

  it('does not let a build host`s own directories name what they touched', () => {
    const built: SubjectLexicon = {
      subject: 'story:card',
      boundaries: 2,
      terms: { files: ['/Users/somebody/checkout/src/Card.tsx'], names: ['Card'] },
    };
    const ran = reportOf([built]);
    expect(scopeOf(ran, 'users').subjects.size).toBe(0);
    expect(scopeOf(ran, 'checkout').subjects.size).toBe(0);
  });

  // The complaint this answers: file names are not unique, so a bare one is not
  // a place. `Activity` is a place because the code declares a component of
  // that name, not because a file happens to be called it.
  it('answers a word from what the code declares', () => {
    expect([...scopeOf(APP, 'Activity').subjects]).toEqual(['story:activity']);
  });

  it('answers the same folder said as a path', () => {
    expect([...scopeOf(APP, 'src/pages/').subjects]).toEqual(['story:activity']);
  });
})

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

  it('reads a trailing wildcard against the absolute path an editor gives you', () => {
    expect([...scopeOf(APP, '/Users/somebody/site/app/about-us/*').subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
    ]);
  });

  it('a wildcard in the middle names one segment and not two', () => {
    expect([...scopeOf(APP, 'app/*/page.tsx').subjects].sort()).toEqual([
      'story:about-page',
      'story:contact',
    ]);
  });
})
