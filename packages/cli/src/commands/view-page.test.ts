// compass: variance-authority.reach.crossings
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseViewArgs } from '../view-args.js';
import type { ViewData } from './view-data.js';
import { viewPage } from './view-page.js';

const DATA: ViewData = {
  suite: 'unit',
  commit: '0b5b312c9d',
  recording: 'cache/unit/record',
  tests: {
    slowestFiles: [{ file: 'src/slow.test.ts', duration: 4200 }, { file: 'src/fast.test.ts', duration: 90 }],
    slowestCases: [{ file: 'src/slow.test.ts', name: 'loads the world', duration: 3900, limit: 5000 }],
    retried: [
      {
        file: 'src/flaky.test.ts',
        name: 'sometimes <fails>',
        attempts: [
          { attempt: 1, ended: 'failed', duration: 120, message: 'expected 1 to be 2' },
          { attempt: 2, ended: 'passed', duration: 110 },
        ],
      },
    ],
    differing: 1,
    notes: [],
  },
  timeline: {
    files: [
      { file: 'src/slow.test.ts', start: 1000, cost: 4200, phases: [{ name: 'setup', ms: 200 }, { name: 'cases', ms: 4000 }], cases: [] },
      { file: 'src/fast.test.ts', start: 5200, cost: 90, phases: [], cases: [] },
    ],
    unplaced: 3,
  },
};

describe('variance view page', () => {
  it('lists the slowest files and cases, and a retried case with every attempt and its message', () => {
    const html = viewPage(DATA);
    expect(html).toContain('src/slow.test.ts');
    expect(html).toContain('loads the world');
    expect(html).toContain('1 failed');
    expect(html).toContain('2 passed');
    expect(html).toContain('expected 1 to be 2');
  });

  it('escapes what a test says', () => {
    const html = viewPage(DATA);
    expect(html).toContain('sometimes &lt;fails&gt;');
    expect(html).not.toContain('sometimes <fails>');
  });

  it('places each file on the clock from its start and cost, and counts the files it cannot place', () => {
    const html = viewPage(DATA);
    // axis: 1000 .. 5290 ms, so the slow file spans 4200 of 4290 and the fast one starts at 4200 of 4290
    expect(html).toContain('left:0.000%;width:97.902%');
    expect(html).toContain('left:97.902%');
    expect(html).toContain('3 recorded files carry no start offset');
  });

  it('has one tab per view, Tests first, and no coverage tab when none was counted', () => {
    const html = viewPage(DATA);
    expect(html).toContain('data-tab="tests"');
    expect(html).toContain('data-tab="timeline"');
    expect(html).not.toContain('data-tab="coverage"');
    expect(viewPage(DATA, { missed: 'no recording' })).toContain('not counted');
  });

  it('is self-contained: no network address, no external script', () => {
    const html = viewPage(DATA);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('variance view arguments', () => {
  it('takes a suite and an output path, and no positional', () => {
    expect(parseViewArgs(readFlags(['--suite', 'unit', '--out', 'a.html'], 'view', ['--suite', '--out'], 'variance view'))).toEqual({ command: 'view', suite: 'unit', out: 'a.html' });
    expect(() => parseViewArgs(readFlags(['x'], 'view', ['--suite', '--out'], 'variance view'))).toThrow();
  });
});
