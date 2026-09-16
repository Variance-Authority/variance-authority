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
describe('a start point names a directory, not a piece of a filename', () => {
  /** Under `src/components/`, with a name ending in the word `Page`. */
  const FOOTER: SubjectLexicon = {
    subject: 'story:footer-for-payment',
    boundaries: 2,
    terms: {
      files: ['src/components/FooterForPaymentPage/FooterForPaymentPage.tsx'],
      names: ['Pay'],
    },
  };

  /** Genuinely under `src/pages/`. */
  const ACTIVITY: SubjectLexicon = {
    subject: 'story:activity',
    boundaries: 2,
    terms: {
      files: ['src/pages/Activity/Activity.tsx'],
      names: ['Activity'],
    },
  };

  /**
   * Compiled somewhere the run had no root for, so the path kept the build
   * host's own directories. Nothing about this subject concerns a user.
   */
  const CARD: SubjectLexicon = {
    subject: 'story:card',
    boundaries: 2,
    terms: {
      files: ['/tmp/scratch/-Users-somebody-dev-app/src/components/Card/Card.tsx'],
      names: ['Card'],
    },
  };

  const APP = reportOf([FOOTER, ACTIVITY, CARD]);

  it('does not answer `pages` with a footer that merely ends in the word', () => {
    expect([...scopeOf(APP, 'pages').subjects]).toEqual(['story:activity']);
  });

  it('lets a file name its own place, extension and all', () => {
    expect([...scopeOf(APP, 'activity').subjects]).toEqual(['story:activity']);
  });

  it('does not let a build host`s own directories name what they touched', () => {
    expect(scopeOf(APP, 'users').subjects.size).toBe(0);
    expect(scopeOf(APP, 'scratch').subjects.size).toBe(1);
  });

  it('reads the directories of an unrooted path like any other', () => {
    expect([...scopeOf(APP, 'components').subjects].sort()).toEqual([
      'story:card',
      'story:footer-for-payment',
    ]);
  });
});

describe('a start point may be the file the caller already has open', () => {
  /** As a run that resolved a root recorded it. */
  const ROOTED: SubjectLexicon = {
    subject: 'story:activity',
    boundaries: 2,
    terms: { files: ['/build/host/scratch/src/pages/Activity/Activity.tsx'], names: ['Activity'] },
  };
  /** The same file, as a run that resolved none recorded it. */
  const UNROOTED: SubjectLexicon = {
    subject: 'story:activity-empty',
    boundaries: 2,
    terms: { files: ['src/pages/Activity/Activity.tsx'], names: ['Activity'] },
  };
  const ELSEWHERE: SubjectLexicon = {
    subject: 'story:card',
    boundaries: 2,
    terms: { files: ['src/components/Card/Activity.tsx'], names: ['Card'] },
  };
  const APP = reportOf([ROOTED, UNROOTED, ELSEWHERE]);

  it('answers a path with the subjects showing that file, under either root', () => {
    expect([...scopeOf(APP, 'src/pages/Activity/Activity.tsx').subjects].sort()).toEqual([
      'story:activity',
      'story:activity-empty',
    ]);
  });

  it('answers the absolute path an editor hands over, rooted deeper than the run', () => {
    const typed = '/Users/somebody/checkout/src/pages/Activity/Activity.tsx';
    expect([...scopeOf(APP, typed).subjects]).toEqual(['story:activity-empty']);
  });

  // Both sides carry a root, neither says so, and a rule loose enough to
  // unify these would unify `apps/web/…/Button.tsx` with `apps/admin/…/Button.tsx`.
  it('does not unify two roots of the same depth, and does not pretend to', () => {
    const typed = '/Users/somebody/checkout/pages/Activity/Activity.tsx';
    expect([...scopeOf(APP, typed).subjects]).not.toContain('story:activity');
  });

  it('reads a tail as a tail, not as a filename shared by two directories', () => {
    expect([...scopeOf(APP, 'Activity/Activity.tsx').subjects].sort()).toEqual([
      'story:activity',
      'story:activity-empty',
    ]);
    expect([...scopeOf(APP, 'Card/Activity.tsx').subjects]).toEqual(['story:card']);
  });

  it('does not call the caller`s own coordinate an unknown word', () => {
    expect(scopeOf(APP, 'src/pages/Activity/Activity.tsx').unmatched).toEqual([]);
  });

  it('empties the scope for a path the run never recorded, and says which', () => {
    const scope = scopeOf(APP, 'src/pages/Ledger/Ledger.tsx');
    expect(scope.subjects.size).toBe(0);
    expect(scope.unmatched).toEqual(['src/pages/ledger/ledger.tsx']);
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
  const APP = reportOf([PAGE, LAYOUT, OTHER]);

  it('the file itself names only what that file shows', () => {
    expect([...scopeOf(APP, 'app/about-us/page.tsx').subjects]).toEqual(['story:about-page']);
  });

  it('a wildcard segment reaches what sits beside it', () => {
    expect([...scopeOf(APP, 'app/about-us/*').subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
    ]);
  });

  it('the directory alone says the same, for a caller who remembers a direction', () => {
    expect([...scopeOf(APP, 'app/about-us/').subjects].sort()).toEqual([
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
