import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { LexiconReport, RunReport, SubjectLexicon } from '@variance-authority/report';
import { scopeLine, scopeOf } from './scope.js';
import { treeOf } from './tree.js';

/**
 * A path exists or it does not, asserted where it is load-bearing.
 *
 * Whether a path is there is a fact about the source tree, so every fixture
 * here builds a tree out of file records — the scanner's own unit — and never
 * out of the paths a report happened to write down. Building the tree from
 * subjects is precisely the defect these tests exist against: it passes
 * whatever the rule is, because the question and the answer come from the same
 * place.
 *
 * Nothing here has an import edge. The tree is the flat set of coordinates and
 * nothing else, so what every case below measures is the path rule alone. What
 * a resolved path is *connected to* is the other half and is asserted in
 * [`scope-reach.test.ts`](./scope-reach.test.ts).
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

/** The repository the coordinates are relative to, for the absolute-path half. */
const ROOT = '/repo';

/** One file the scan found, with no imports read off it. */
const found = (file: string): FileRecord => ({ file });

const SOURCE: readonly FileRecord[] = [
  found('src/billing/InvoiceTable.tsx'),
  found('src/billing/Statement.tsx'),
  found('src/shipping/DispatchDrawer.tsx'),
  found('src/shared/Badge.tsx'),
  // Real, and nothing rendered it. The run's notes do not hold this path and
  // the tree does, which is the whole difference between the two authorities.
  found('src/tools/seed.ts'),
];

const TREE = treeOf(SOURCE, ROOT);

/** In `src/billing/`, and its own words never say the word `billing`. */
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
    files: ['src/shipping/DispatchDrawer.tsx'],
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

describe('the tree says what exists, and the run says what it produced', () => {
  it('resolves a real file no subject came from, rather than calling it missing', () => {
    // Found and empty. A different sentence from *there is no such place*, and
    // the defect this replaces could not tell them apart because a path the run
    // never wrote down and a path that is not there took the same branch.
    const scope = scopeOf(REPORT, 'src/tools/seed.ts', TREE);
    expect(scope.refused).toBeUndefined();
    expect(scope.subjects.size).toBe(0);
    expect(scope.entries).toBe(1);
  });

  it('refuses a path the run recorded and the tree does not hold', () => {
    // A build wrote this path into the run's notes. Nothing is there now, and a
    // coordinate answered out of a run's memory is a *found* that is not.
    const built = reportOf([
      { subject: 'story:bundled', boundaries: 1, terms: { files: ['dist/assets/billing-4f2a.js'] } },
    ]);
    const scope = scopeOf(built, 'dist/assets/billing-4f2a.js', TREE);
    expect(scope.refused).toContain('not found');
    expect(scope.subjects.size).toBe(0);
  });

  it('says the two sides spell paths differently, rather than answering nothing', () => {
    // A bundle served from `storybook-static/assets/` resolves its map's
    // `../../src/InvoiceTable.tsx` against the module it was served as, and the
    // `..` clamps at the origin: the run writes down `src/InvoiceTable.tsx` for
    // a file the tree holds at `src/billing/InvoiceTable.tsx`. Every value is a
    // real source path and not one of them is a path in this repository, which
    // is a fact about the two spellings and not about the application.
    const served = reportOf([
      {
        subject: 'billing/invoice-table--overdue',
        boundaries: 4,
        terms: { files: ['src/InvoiceTable.tsx'] },
      },
      { subject: 'billing/statement--paid', boundaries: 2, terms: { files: ['src/Statement.tsx'] } },
    ]);
    const scope = scopeOf(served, 'src/billing/', TREE);

    expect(scope.subjects.size).toBe(0);
    expect(scope.recorded).toBe(2);
    expect(scope.strangers).toBe(2);
    expect(scopeLine(scope, 2)).toContain('the source tree holds none of them');
  });

  it('keeps answering when only some recorded paths are strangers', () => {
    // A run records a file the checkout has since deleted. That is ordinary and
    // says nothing about how either side spells a path, so the diagnosis above
    // must not fire on it.
    const mixed = reportOf([
      INVOICE,
      { subject: 'story:gone', boundaries: 1, terms: { files: ['src/billing/Removed.tsx'] } },
    ]);
    const scope = scopeOf(mixed, 'src/billing/', TREE);

    expect([...scope.subjects]).toEqual(['billing/invoice-table--overdue']);
    expect(scope.strangers).toBe(1);
    expect(scopeLine(scope, 2)).toContain('Searched 1 of 2');
  });

  it('refuses when no tree was read, instead of falling back to the run', () => {
    // And says so in different words: nothing is wrong with the path, the
    // question was asked somewhere the source is not.
    const scope = scopeOf(REPORT, 'src/billing/', undefined);
    expect(scope.refused).toContain('no source tree was read');
    expect(scope.refused).not.toContain('not found');
    expect(scope.subjects.size).toBe(0);
  });
});

describe('a start point is a place on disk and nothing else', () => {
  it('names the area, not the screen with the area written on a button', () => {
    // `billing` is in DISPATCH's `names` and `text` and in the other two's ids
    // and files. A scope that searched what a subject shows would hold all
    // three, and the one it would be most confident about is the wrong one.
    const scope = scopeOf(REPORT, 'src/billing/', TREE);
    expect([...scope.subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
    ]);
  });

  it('rejects a start point the tree holds no file at', () => {
    // Not an empty answer. The caller handed over a coordinate and the tree
    // does not have it, which is a different fact from the place existing and
    // holding nothing.
    const scope = scopeOf(REPORT, 'src/warehousing/', TREE);
    expect(scope.refused).toContain('not found');
    expect(scope.subjects.size).toBe(0);
  });

  it('rejects a component name that is nowhere on disk', () => {
    // `InvoiceTable` is a real component of a real subject. A component is not
    // a location, and nothing is looked up but locations.
    expect(scopeOf(REPORT, 'InvoiceTable', TREE).refused).toContain('not found');
  });

  it('rejects a filename, because a filename is not a path', () => {
    // Not because two packages have one. Because no file is at `Badge.tsx`.
    // The same answer comes back in a tree holding exactly one of them: there
    // is no file at that path, so there is nothing there.
    const both = [found('packages/web/Badge.tsx'), found('packages/admin/Badge.tsx')];
    const report = reportOf([
      { subject: 'story:a', boundaries: 1, terms: { files: ['packages/web/Badge.tsx'] } },
      { subject: 'story:b', boundaries: 1, terms: { files: ['packages/admin/Badge.tsx'] } },
    ]);
    for (const records of [both, both.slice(0, 1)]) {
      const scope = scopeOf(report, 'Badge.tsx', treeOf(records, ROOT));
      expect(scope.refused).toContain('not found');
      expect(scope.subjects.size).toBe(0);
    }
    expect([...scopeOf(report, 'packages/web/Badge.tsx', treeOf(both, ROOT)).subjects]).toEqual([
      'story:a',
    ]);
  });

  it('does not read one path as another because one ends with it', () => {
    // A vendored copy is a second real file at a second real coordinate.
    // Reading the shorter as the longer is the fragment rule under another name.
    const tree = treeOf([found('src/billing/Card.tsx'), found('vendor/copy/src/billing/Card.tsx')], ROOT);
    const report = reportOf([
      { subject: 'story:a', boundaries: 1, terms: { files: ['src/billing/Card.tsx'] } },
      { subject: 'story:b', boundaries: 1, terms: { files: ['vendor/copy/src/billing/Card.tsx'] } },
    ]);
    expect([...scopeOf(report, 'src/billing/Card.tsx', tree).subjects]).toEqual(['story:a']);
    expect([...scopeOf(report, 'vendor/copy/src/billing/Card.tsx', tree).subjects]).toEqual(['story:b']);
  });

  it('rejects a wildcard anywhere but the last segment', () => {
    // A `*` in the middle is a pattern, and a pattern is not a path.
    expect(scopeOf(REPORT, 'src/*/Statement.tsx', TREE).refused).toContain('not found');
    expect(scopeOf(REPORT, 'src/bil*/Statement.tsx', TREE).refused).toContain('not found');
    expect(scopeOf(REPORT, '*', TREE).refused).toContain('not found');
  });

  it('does not fold case, because a path that differs in case does not exist', () => {
    const tree = treeOf([found('src/Billing/Card.tsx')], ROOT);
    const report = reportOf([
      { subject: 'story:a', boundaries: 1, terms: { files: ['src/Billing/Card.tsx'] } },
    ]);
    expect(scopeOf(report, 'src/billing/', tree).refused).toContain('not found');
    expect([...scopeOf(report, 'src/Billing/', tree).subjects]).toEqual(['story:a']);
  });

  it('never answers a path from anything but the files a subject was seen in', () => {
    // `Badge` is a component of both INVOICE and DISPATCH. Said as a path, the
    // file answers and the component does not — which is why a component shared
    // by two subjects cannot widen a scope.
    expect([...scopeOf(REPORT, 'src/billing/InvoiceTable.tsx', TREE).subjects]).toEqual([
      'billing/invoice-table--overdue',
    ]);
  });

  it('takes every path, because two paths are two entry points', () => {
    // Two entry points into one investigation are two places to be answered
    // from. The files common to both are very nearly always none, so keeping
    // only those would answer nothing where the caller was most specific.
    const scope = scopeOf(REPORT, ['src/billing/', 'src/shipping/'], TREE);
    expect([...scope.subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
      'shipping/dispatch-drawer--overdue',
    ]);
  });

  it('says which path named nowhere, rather than only that nothing did', () => {
    const scope = scopeOf(REPORT, ['src/billing/', 'src/warehousing/'], TREE);
    expect(scope.subjects.size).toBe(0);
    expect(scope.unmatched).toEqual(['src/warehousing/']);
  });

  it('rejects a stray word beside a good path instead of ignoring it', () => {
    // Skipping it would make a typo indistinguishable from a caller who meant
    // to narrow twice, and would answer a wider question than was asked.
    expect(scopeOf(REPORT, ['src/billing/', 'warehousing'], TREE).refused).toContain('not found');
  });

  it('reads a path exactly as written, quotes and commas included', () => {
    // Stripping them is a guess about how somebody types, and it lands on
    // characters that are legal in a name.
    expect(scopeOf(REPORT, '"src/billing/",', TREE).refused).toContain('not found');
  });

  it('takes a path with a space in it, because a space is a character in a name', () => {
    // Splitting a start point on whitespace makes this file unsayable and
    // answers *not found* about a file that is plainly there — a false
    // negative, which is the one thing the rule may never produce.
    const tree = treeOf([found('src/billing/Invoice Table.tsx')], ROOT);
    const report = reportOf([
      { subject: 'story:a', boundaries: 1, terms: { files: ['src/billing/Invoice Table.tsx'] } },
    ]);
    expect([...scopeOf(report, 'src/billing/Invoice Table.tsx', tree).subjects]).toEqual(['story:a']);
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
  const APP_TREE = treeOf(
    [
      found('src/components/FooterForPaymentPage/FooterForPaymentPage.tsx'),
      found('src/pages/Activity/Activity.tsx'),
    ],
    ROOT,
  );

  it('does not answer a folder with a file whose name merely holds it', () => {
    expect([...scopeOf(APP, 'src/pages/', APP_TREE).subjects]).toEqual(['story:activity']);
  });

  it('does not stem a segment, because a coordinate was not a guess', () => {
    // `page` is not `pages`. A caller who typed the folder they are standing in
    // did not ask to be taken to its neighbour.
    expect(scopeOf(APP, 'src/page/', APP_TREE).refused).toContain('not found');
  });

  it('does not drop an extension, because two files may differ only there', () => {
    expect(scopeOf(APP, 'src/pages/Activity/Activity.ts', APP_TREE).refused).toContain('not found');
    expect([...scopeOf(APP, 'src/pages/Activity/Activity.tsx', APP_TREE).subjects]).toEqual([
      'story:activity',
    ]);
  });
});

describe('an absolute path is the same question, asked from the root', () => {
  it('reads a path under the root as the coordinate the tree holds', () => {
    // The path an editor hands over is absolute. Under the root it names
    // exactly the file, at whatever width the caller said it.
    expect([...scopeOf(REPORT, '/repo/src/billing/', TREE).subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
    ]);
    expect([...scopeOf(REPORT, '/repo/src/billing/InvoiceTable.tsx', TREE).subjects]).toEqual([
      'billing/invoice-table--overdue',
    ]);
  });

  it('refuses a path outside the root, because this repository does not contain it', () => {
    // A real path to a real file somewhere else is not found here, and that is
    // an answer rather than an error.
    expect(scopeOf(REPORT, '/Users/somebody/site/src/billing/', TREE).refused).toContain('not found');
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
  const APP_TREE = treeOf(
    [
      found('app/about-us/page.tsx'),
      found('app/about-us/layout.tsx'),
      found('app/about-us/team/page.tsx'),
      found('app/contact/page.tsx'),
    ],
    ROOT,
  );

  it('the file itself names only what that file shows', () => {
    expect([...scopeOf(APP, 'app/about-us/page.tsx', APP_TREE).subjects]).toEqual(['story:about-page']);
  });

  it('a trailing wildcard is the files of that folder and nothing deeper', () => {
    expect([...scopeOf(APP, 'app/about-us/*', APP_TREE).subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
    ]);
    // `app` holds no file of its own, so its own files are nothing at all —
    // which is not found, and not an empty answer about a folder that is there.
    expect(scopeOf(APP, 'app/*', APP_TREE).refused).toContain('not found');
  });

  it('the folder alone is everything underneath it', () => {
    expect([...scopeOf(APP, 'app/about-us/', APP_TREE).subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
      'story:about-team',
    ]);
    expect([...scopeOf(APP, 'app/', APP_TREE).subjects].sort()).toEqual([
      'story:about-layout',
      'story:about-page',
      'story:about-team',
      'story:contact',
    ]);
  });
});

describe('an empty scope says what was looked for and where', () => {
  it('names the path the tree holds no file at', () => {
    const line = scopeLine(scopeOf(REPORT, 'src/warehousing/', TREE), 3);
    expect(line).toContain('`src/warehousing/` is not found');
    expect(line).toContain('leave the start point out');
  });

  it('names every path when one of several is not there', () => {
    const line = scopeLine(scopeOf(REPORT, ['src/billing/', 'src/warehousing/'], TREE), 3);
    expect(line).toContain('`src/warehousing/` is not found');
    expect(line).not.toContain('`src/billing/` is not found');
  });
});
