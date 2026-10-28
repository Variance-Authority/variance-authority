import { describe, expect, it } from 'vitest';
import type { SuiteChange } from '@variance-authority/sense/test-selection';
import type { Coverage } from './coverage.js';
import type { Review } from './review.js';
import { formatCoverage } from './coverage-text.js';
import { formatReview, reviewPieces } from './review-text.js';

const CHANGE: SuiteChange = {
  gained: 2, lost: 0, hidden: 0, unmeasured: 0, thinned: 0,
  written: { regions: 0, run: 0 }, deleted: { regions: 0, run: 0 },
  arrived: { regions: 0, run: 0, files: [] }, departed: { regions: 0, run: 0, files: [] }, testFiles: [],
};
const UNIT: Coverage = {
  at: '0b5b312c',
  count: { regions: 29010, files: 836, run: 24697, load: 138, none: 4175, unjoined: 0, suites: [{ name: 'unit', kind: 'unit', run: 24697, load: 138, regions: 29010 }] },
  base: { regions: 29010, files: 836, run: 24695, load: 138, none: 4177, unjoined: 0, suites: [{ name: 'unit', kind: 'unit', run: 24695, load: 138, regions: 29010 }] },
  suites: [{ suite: 'unit', kind: 'unit', from: 'unit.bin', recorded: '0b5b312c', base: { from: 'base.bin', commit: 'cc25d6a6', change: CHANGE } }],
};
const INTEGRATION: Coverage = {
  at: '0b5b312c',
  count: { regions: 21848, files: 582, run: 3323, load: 483, none: 18042, unjoined: 0, suites: [{ name: 'integration', kind: 'integration', run: 3323, load: 483, regions: 21848 }] },
  suites: [{ suite: 'integration', kind: 'integration', from: 'integration.bin', baseMissed: 'no base: integration is not given to the share' }],
};
const REVIEW: Review = {
  from: 'cc25d6a6', base: 'since', record: 'ran', files: [], suite: 679, recordedSuite: 'unit',
  runs: { first: '2026-10-01', latest: '2026-10-01', runs: 1, files: ['a.test.ts', 'b.test.ts', 'c.test.ts'] },
  coverage: [UNIT, INTEGRATION],
};

/** What a reviewer sees before opening any disclosure. */
function closed(markdown: string): string {
  let depth = 0;
  return markdown.split('\n').filter((line) => {
    if (line.includes('<details>')) depth += 1;
    if (line.includes('</details>')) { depth -= 1; return false; }
    return depth === 0;
  }).join('\n');
}

describe('one review summary with coverage available on demand', () => {
  it('exposes the real execution change even when its percentage rounds to unchanged', () => {
    const markdown = formatReview(REVIEW, 'markdown');
    const firstScreen = closed(markdown);
    expect(firstScreen).toContain('| `unit` | 2 regions newly run |');
    // The runs named no commit, so the comment names none: "this commit" is ambiguous on a merge.
    expect(firstScreen).toContain('`unit`: 3 test files ran in these runs. The other 676 retain earlier recordings.');
    expect(firstScreen).toContain('Compared with the recordings at `cc25d6a6` (unit).');
    expect(firstScreen).toContain('No baseline available; change cannot be compared');
    expect(firstScreen).not.toMatch(/%|29,010|21,848/);
    expect(markdown).toContain('| `unit` | 85.1% | 85.1% previously; 2 regions newly run |');
    expect(markdown).toContain('| `integration` | 15.2% | No baseline available; change cannot be compared |');
    expect(markdown).toContain('their percentages cannot be added');
  });

  it('puts each suite in and out behind the coverage disclosure, not on the first screen', () => {
    const earned = { regions: 20000, in: 12000, out: 15000, accidental: 6000, unmeasured: 10 };
    const markdown = formatReview({ ...REVIEW, coverage: [{ ...UNIT, earned: { suites: [{ name: 'unit', kind: 'unit', ...earned }], total: earned } }, INTEGRATION] }, 'markdown');
    expect(markdown).toContain('| `unit` | 20,000 | 60.0% | 75.0% | 6,000 (30.0%) |');
    expect(closed(markdown)).not.toContain('20,000');
  });

  it('keeps missing recordings and unreadable coverage visible without replacing them with zero', () => {
    const empty: Coverage = { ...INTEGRATION, suites: [{ suite: 'browser' }], count: { regions: 0, files: 0, run: 0, load: 0, none: 0, unjoined: 0, suites: [] } };
    const markdown = formatReview({ ...REVIEW, coverage: [UNIT, empty, { suite: 'broken', missed: 'the index could not be read' }] }, 'markdown');
    expect(closed(markdown)).toContain('| `browser` | Unrecorded |');
    expect(closed(markdown)).toContain('| `broken` | Coverage unavailable |');
    expect(markdown).not.toContain('0.0%');
    expect(markdown).toContain('the index could not be read');
    expect(markdown).toContain('| `unit` | 85.1%');
  });

  it('shows execution lost even when gains outweigh it, with denominator changes available in detail', () => {
    const changed: Coverage = { ...UNIT, suites: [{ ...UNIT.suites[0]!, base: { ...UNIT.suites[0]!.base!, change: {
      ...CHANGE, gained: 7, lost: 3, hidden: 2, written: { regions: 17, run: 4 }, deleted: { regions: 17, run: 4 },
    } } }] };
    const markdown = formatReview({ ...REVIEW, coverage: [changed] }, 'markdown');
    expect(closed(markdown)).toContain('3 regions no longer run');
    expect(closed(markdown)).toContain('2 regions no longer run after a case stopped');
    expect(closed(markdown)).toContain('7 regions newly run');
    expect(closed(markdown)).toContain('Code changed; see coverage details');
    expect(closed(markdown)).not.toContain('17');
    // The parts add up to the suite's change, so a reader can check one against the other.
    expect(markdown).toContain(
      '`unit` regions run by cases, 24,695 → 24,697 (+2): +7 newly run · −3 no longer run · ' +
        '−2 no longer run after a case stopped · +4 run in 17 added regions · −4 had run in 17 removed regions.',
    );
    expect(markdown).not.toMatch(/hidden|written|thinned/u);
  });

  it('names the regions each test file no longer runs, and counts the test files it does not name', () => {
    const region = (file: string, kind: string, name: string, startLine: number, endLine: number) => ({ file, kind, name, startLine, endLine });
    const top = region('src/jest.ts', 'module', '', 26, 500);
    const filter = region('src/jest.ts', 'function', 'withFilter', 40, 60);
    const left = (file: string, regions: readonly ReturnType<typeof region>[]) => ({ file, entered: [], left: regions });
    const testFiles = [
      left('test/a.test.ts', [top, filter, region('src/rstest.ts', 'module', '', 24, 399), region('src/rstest.ts', 'function', 'run', 30, 40)]),
      left('test/b.test.ts', [top]),
      left('test/c.test.ts', [top]),
      left('test/d.test.ts', [top]),
      left('test/e.test.ts', [top]),
      { file: 'test/f.test.ts', entered: [filter], left: [] },
    ];
    const lost: Coverage = { ...UNIT, suites: [{ ...UNIT.suites[0]!, base: { ...UNIT.suites[0]!.base!, change: { ...CHANGE, gained: 0, lost: 4, testFiles } } }] };

    const lines = formatCoverage(lost, 'text').split('\n');
    expect(lines).toContain(
      '  unit: test/a.test.ts no longer runs the top level, withFilter in src/jest.ts; the top level, run in src/rstest.ts (4 regions) at the base',
    );
    expect(lines).toContain('  unit: test/b.test.ts no longer runs the top level in src/jest.ts (1 region) at the base');
    expect(lines).toContain('  unit: ... and 2 more test files that lost regions, not listed here; --format json lists every one.');
    expect(lines).toContain('  unit: test/f.test.ts now runs withFilter in src/jest.ts (1 region) not run at the base');
    expect(formatCoverage(lost, 'markdown')).toContain('- unit: ... and 2 more test files that lost regions, not listed here; --format json lists every one.');
  });

  it('counts the functions a test file moved past four, in one file', () => {
    const regions = ['a', 'b', 'c', 'd', 'e'].map((name, index) => ({ file: 'src/jest.ts', kind: 'function', name, startLine: index * 10 + 1, endLine: index * 10 + 9 }));
    const testFiles = [{ file: 'test/a.test.ts', entered: [], left: regions }];
    const lost: Coverage = { ...UNIT, suites: [{ ...UNIT.suites[0]!, base: { ...UNIT.suites[0]!.base!, change: { ...CHANGE, gained: 0, lost: 5, testFiles } } }] };
    expect(formatCoverage(lost, 'text').split('\n')).toContain('  unit: test/a.test.ts no longer runs 5 functions in 1 file (5 regions) at the base');
  });

  it('says so when the parts do not add up to the suite\'s change', () => {
    const off: Coverage = { ...UNIT, suites: [{ ...UNIT.suites[0]!, base: { ...UNIT.suites[0]!.base!, change: { ...CHANGE, gained: 5 } } }] };
    expect(formatReview({ ...REVIEW, coverage: [off] }, 'markdown')).toContain(
      '`unit` regions run by cases, 24,695 → 24,697 (+2): +5 newly run. These parts add to +5, not +2.',
    );
  });

  it('names the commit the runs were at, and leaves the source no suite recorded to `variance coverage`', () => {
    const at = { ...REVIEW, runs: { ...REVIEW.runs!, commit: `e7720ded${'0'.repeat(32)}` }, coverage: [{ ...UNIT, sourceMissed: 'no source index' }] };
    const markdown = formatReview(at, 'markdown');
    expect(closed(markdown)).toContain('`unit`: 3 test files ran at `e7720ded0000`.');
    expect(markdown).not.toContain('Files no suite recorded');
    expect(formatCoverage(at.coverage[0]!, 'markdown')).toContain('Files no suite recorded');
  });

  it('includes the carried coverage when the same artifact is printed in text', () => {
    expect(formatReview(REVIEW, 'text')).toContain('coverage at 0b5b312c');
    expect(formatReview(REVIEW, 'text')).toContain('integration: no base');
  });

  it('retains the earlier-record warning when the changed text has not run', () => {
    const markdown = formatReview({ ...REVIEW, record: 'before' }, 'markdown');
    expect(closed(markdown)).toContain('The record was made before this change');
    expect(closed(markdown)).not.toContain('test files ran');
  });

  it('carries the evidence through JSON without recomputing it from local recordings', () => {
    const restored = JSON.parse([...reviewPieces(REVIEW, 'json')].join('')) as Review;
    expect(formatReview(restored, 'markdown')).toBe(formatReview(REVIEW, 'markdown'));
  });

  it('keeps module-load execution apart and hides standalone inventories', () => {
    const markdown = formatCoverage(UNIT, 'markdown');
    expect(closed(markdown)).not.toContain('24,697');
    expect(markdown).toContain('| Module-load execution only | 138 | 0.5% |');
    expect(markdown).not.toContain('| **any suite**');
    expect(markdown).not.toContain('| Suite | Kind |');
    expect(markdown).toContain('unit recorded at 0b5b312c');
    expect(markdown).toContain('unit compared with cc25d6a6');
  });
});
