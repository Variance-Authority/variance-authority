import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { LexiconReport, RunReport, SubjectLexicon } from '@variance-authority/report';
import { locate, locateSubjects } from './locate.js';
import { orient } from './orient.js';
import { scopeLine, scopeOf } from './scope.js';
import { treeOf } from './tree.js';

/**
 * The path is the entrance, not the room.
 *
 * A start point names entry points and the import graph decides the scope:
 * every file connected to those, along the arrows or against them, at any
 * depth. That is the half of the rule the path itself cannot state, and it is
 * the half the reader is actually buying — somebody who says *the checkout
 * page* means the page and its forty neighbours, not one file.
 *
 * So every fixture here is a tree of edges, built out of file records and never
 * out of the paths a report wrote down. Whether a path *exists* is the other
 * half and is asserted in [`scope.test.ts`](./scope.test.ts).
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const ROOT = '/repo';

/** One file the scan found, and the files it was seen importing. */
const reads = (file: string, ...to: readonly string[]): FileRecord =>
  to.length === 0 ? { file } : { file, edges: to.map((target) => ({ to: target, kind: 'imports' as const })) };

/**
 * Two areas that share no file, and a chain three deep under one of them.
 *
 * Billing rests on `total.ts`, which rests on `round.ts`, which rests on
 * `precision.ts`. Nothing joins billing to shipping, so a start point in one
 * reaching the other would be the mechanism inventing a relation.
 */
const SOURCE: readonly FileRecord[] = [
  reads('src/billing/InvoiceTable.tsx', 'src/billing/total.ts'),
  {
    file: 'src/billing/Statement.tsx',
    edges: [
      { to: 'src/billing/total.ts', kind: 'imports' },
      // A type-only import. Nothing behind it can run, and a reader asking
      // where something lives is asking about source, so it is walked.
      { to: 'src/billing/amount.d.ts', kind: 'type' },
    ],
  },
  reads('src/billing/total.ts', 'src/lib/round.ts'),
  reads('src/lib/round.ts', 'src/lib/precision.ts'),
  reads('src/lib/precision.ts'),
  reads('src/billing/amount.d.ts'),
  reads('src/shipping/DispatchDrawer.tsx', 'src/shipping/route.ts'),
  reads('src/shipping/route.ts'),
  // Real, connected to nothing, and nothing rendered it.
  reads('src/tools/seed.ts'),
];

const TREE = treeOf(SOURCE, ROOT);

const INVOICE: SubjectLexicon = {
  subject: 'billing/invoice-table--overdue',
  boundaries: 4,
  terms: {
    example: ['InvoiceTable'],
    components: ['InvoiceTable'],
    files: ['src/billing/InvoiceTable.tsx'],
    names: ['Invoices', 'Overdue'],
    roles: ['table', 'status'],
  },
  landmarks: [
    { role: 'group', name: 'Carrier', box: [0, 0, 240, 20] },
    { role: 'status', text: 'Contract expired', box: [0, 28, 240, 20], file: 'src/billing/InvoiceTable.tsx', line: 41 },
  ],
};

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

/** In shipping, and it says `billing` out loud. The decoy, again. */
const DISPATCH: SubjectLexicon = {
  subject: 'shipping/dispatch-drawer--overdue',
  boundaries: 6,
  terms: {
    example: ['DispatchDrawer'],
    components: ['DispatchDrawer'],
    files: ['src/shipping/DispatchDrawer.tsx'],
    names: ['Billing', 'Overdue'],
    text: ['Billing', 'Overdue'],
    roles: ['dialog', 'status'],
  },
  landmarks: [
    { role: 'group', name: 'Carrier', box: [0, 0, 240, 20] },
    {
      role: 'status',
      text: 'Contract expired',
      box: [0, 28, 240, 20],
      file: 'src/shipping/DispatchDrawer.tsx',
      line: 77,
    },
  ],
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

describe('the path is the entrance, not the room', () => {
  it('counts the files named apart from the files connected to them', () => {
    // Four files are at `src/billing/`; six are in the scope. The difference is
    // the whole claim, and a caller who cannot see both numbers cannot tell a
    // narrow question from a wide one.
    const scope = scopeOf(REPORT, 'src/billing/', TREE);
    expect(scope.entries).toBe(4);
    expect(scope.reachable).toBe(6);
  });

  it('follows what a file rests on, however far down it goes', () => {
    // `InvoiceTable.tsx` → `total.ts` → `round.ts` → `precision.ts`. A walk cut
    // off at a depth would leave `precision.ts` out, and a file that genuinely
    // is connected being reported as not connected is a false negative.
    const scope = scopeOf(REPORT, 'src/billing/InvoiceTable.tsx', TREE);
    expect(scope.entries).toBe(1);
    expect(scope.reachable).toBe(4);
    expect([...scope.subjects]).toEqual(['billing/invoice-table--overdue']);
  });

  it('follows what rests on a file, however far up it goes', () => {
    // From the leaf the arrows run the other way, three of them, and the two
    // screens at the top are the answer. This is the shape of the question a
    // person actually asks — *I am in this helper; what shows it?*
    const scope = scopeOf(REPORT, 'src/lib/precision.ts', TREE);
    expect(scope.entries).toBe(1);
    expect(scope.reachable).toBe(5);
    expect([...scope.subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'billing/statement--paid',
    ]);
  });

  it('walks a type-only import, because a type is a file in the neighbourhood', () => {
    // Nothing behind a type import can run, so the runtime traversal leaves it
    // out. A reader asking where something lives is asking about source.
    const scope = scopeOf(REPORT, 'src/billing/amount.d.ts', TREE);
    expect(scope.reachable).toBe(2);
    expect([...scope.subjects]).toEqual(['billing/statement--paid']);
  });

  it('does not reach an area nothing connects it to', () => {
    // `src/shipping/` is real, and no arrow runs between it and billing. The
    // decoy says `billing` on a button and is still not in the scope.
    const scope = scopeOf(REPORT, 'src/billing/', TREE);
    expect(scope.subjects.has('shipping/dispatch-drawer--overdue')).toBe(false);
  });

  it('answers a file connected to nothing with itself and nothing else', () => {
    // The seeds are in their own closure, so an isolated file resolves rather
    // than reading as absent. Found, connected to one file, and holding no
    // subject: three separate facts, all of them true.
    const scope = scopeOf(REPORT, 'src/tools/seed.ts', TREE);
    expect(scope.refused).toBeUndefined();
    expect(scope.reachable).toBe(1);
    expect(scope.subjects.size).toBe(0);
  });

  it('takes the union of what several entry points reach', () => {
    const scope = scopeOf(REPORT, ['src/billing/InvoiceTable.tsx', 'src/shipping/'], TREE);
    expect([...scope.subjects].sort()).toEqual([
      'billing/invoice-table--overdue',
      'shipping/dispatch-drawer--overdue',
    ]);
  });

  it('holds a file both areas import, and what that file produced elsewhere', () => {
    // A subject is in scope when a file in scope produced it, and a shared leaf
    // is produced by everything that renders it. The walk from billing reaches
    // `Badge.tsx` and stops there — a leaf imports nothing and nothing is
    // reachable through one — but the run recorded the shipping screen as having
    // been seen in that same leaf, so the shipping screen is in scope. What
    // widens the answer here is the run's record of what each subject rendered,
    // not the import graph.
    const shared = treeOf(
      [
        reads('app/billing/Page.tsx', 'src/shared/Badge.tsx'),
        reads('app/shipping/Page.tsx', 'src/shared/Badge.tsx'),
        reads('src/shared/Badge.tsx'),
      ],
      ROOT,
    );
    const report = reportOf([
      {
        subject: 'billing/page--default',
        boundaries: 2,
        terms: { files: ['app/billing/Page.tsx', 'src/shared/Badge.tsx'] },
      },
      {
        subject: 'shipping/page--default',
        boundaries: 2,
        terms: { files: ['app/shipping/Page.tsx', 'src/shared/Badge.tsx'] },
      },
    ]);
    const scope = scopeOf(report, 'app/billing/', shared);
    expect(scope.reachable).toBe(2);
    expect([...scope.subjects].sort()).toEqual(['billing/page--default', 'shipping/page--default']);
  });

  it('counts the files whose imports could not be read, rather than widening over them', () => {
    // What lies behind an unreadable file is not knowable from the graph, so
    // the scope is not a proof about what it leaves out. Unioning in every file
    // that reaches one is a number no start point would survive, so the hole is
    // counted and said.
    const holed = treeOf(
      [reads('app/x/Page.tsx', 'app/x/opaque.ts'), { file: 'app/x/opaque.ts', unknown: 'could not parse' }],
      ROOT,
    );
    const report = reportOf([
      { subject: 'x/page--default', boundaries: 2, terms: { files: ['app/x/Page.tsx'] } },
    ]);
    const scope = scopeOf(report, 'app/x/', holed);
    expect(scope.unresolved).toEqual(['app/x/opaque.ts']);
    expect(scopeLine(scope, 1)).toContain('1 file(s) in it import something the scan could not resolve');
  });
});

describe('what a start point does to an answer', () => {
  it('removes the subjects outside it rather than ranking them lower', () => {
    // `Billing` is in the shipping subject's names and text, and `billing` is
    // nowhere in the invoice subject's words. Unscoped the decoy wins.
    const everywhere = locateSubjects(REPORT, 'billing overdue');
    expect(everywhere.hits[0]?.subject).toBe('shipping/dispatch-drawer--overdue');

    const scoped = locateSubjects(REPORT, 'billing overdue', 'src/billing/', TREE);
    expect(scoped.hits.map((hit) => hit.subject)).not.toContain('shipping/dispatch-drawer--overdue');
  });

  it('is a boundary, so a refused start point searches nothing', () => {
    // Answering out of the suite the caller narrowed away from would answer a
    // question nobody asked, and would look exactly like a good answer.
    const refused = locateSubjects(REPORT, 'billing overdue', 'src/warehousing/', TREE);
    expect(refused.hits).toEqual([]);
    expect(refused.scope?.refused).toContain('not found');
  });

  it('prints what was searched and what it was reached from', () => {
    const text = locate.run(REPORT, { query: 'overdue', from: 'src/billing/' }, { tree: TREE });
    expect(text).toContain('4 file(s) named, 6 connected to them');
    expect(text).toContain('`src/billing/`');
  });

  it('asks for the tree exactly when a start point was given', () => {
    // Reading the tree is a walk of the repository. A tool list where every
    // call paid for one would tax every question to serve the few that take a
    // path.
    expect(locate.wants?.({ query: 'overdue', from: 'src/billing/' })).toBe(true);
    expect(locate.wants?.({ query: 'overdue' })).toBe(false);
  });

  it('refuses a start point when the host read no tree, rather than answering wider', () => {
    const text = locate.run(REPORT, { query: 'overdue', from: 'src/billing/' }, {});
    expect(text).toContain('no source tree was read');
  });
});

describe('a start point reaches the arrangement too', () => {
  it('keeps a relation question inside the area it was asked from', () => {
    // Both surfaces put the same warning under the same field, and only one of
    // them is in the area. A scope that stopped at the word search would narrow
    // the ids and leave the places alone.
    const everywhere = orient(REPORT, 'the contract warning under Carrier');
    expect(everywhere.hits.map((hit) => hit.subject).sort()).toEqual([
      'billing/invoice-table--overdue',
      'shipping/dispatch-drawer--overdue',
    ]);

    const scoped = orient(REPORT, 'the contract warning under Carrier', 'src/billing/', TREE);
    expect(scoped.hits.map((hit) => hit.subject)).toEqual(['billing/invoice-table--overdue']);
    expect(scoped.scope?.entries).toBe(4);
  });

  it('refuses the arrangement question too when the path names nowhere', () => {
    const scoped = orient(REPORT, 'the contract warning under Carrier', 'src/warehousing/', TREE);
    expect(scoped.hits).toEqual([]);
    expect(scoped.scope?.refused).toContain('not found');
  });
});
