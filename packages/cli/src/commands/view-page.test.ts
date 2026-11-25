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
    recorded: 5,
    placed: 2,
    unplaced: 3,
  },
  reach: {
    tests: [
      { file: 'src/slow.test.ts', reached: ['src/world.ts', 'src/price.ts'], total: 2 },
      { file: 'src/flaky.test.ts', reached: ['src/price.ts'], total: 1 },
    ],
    files: [
      { file: 'src/price.ts', tests: ['src/flaky.test.ts', 'src/slow.test.ts'], total: 2 },
      { file: 'src/world.ts', tests: ['src/slow.test.ts'], total: 1 },
    ],
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

  it('counts the files the cut left out in the header, not the rows it kept', () => {
    const html = viewPage({ ...DATA, timeline: { ...DATA.timeline, recorded: 250, placed: 180, unplaced: 70 } });
    expect(html).toContain('250 recorded, 180 placed on the clock');
    expect(html).toContain('2 of 180 placed files');
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
    expect(html).toContain('3 recorded files carry no start or no cost');
  });

  it('has one tab per view, Tests first, and no coverage tab when neither coverage nor a relation exists', () => {
    const html = viewPage({ ...DATA, reach: { tests: [], files: [] } });
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

describe('variance view drill-down', () => {
  const pane = (html: string, file: string): string => {
    const at = html.indexOf(`<article class="pane" data-key="${file}"`);
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</article>', at));
  };

  it('opens a test file on a pane that is no tab, and links every test row to it', () => {
    const html = viewPage(DATA);
    expect(html).toContain('data-view="test"');
    expect(html).not.toContain('data-tab="test"');
    expect(html).toContain('href="#test/src%2Fslow.test.ts"');
    expect(html).toContain('href="#test/src%2Fflaky.test.ts"');
  });

  it('shows a retried case\'s every attempt: outcome, duration, message and nearest frame', () => {
    const flaky = pane(viewPage({ ...DATA, tests: { ...DATA.tests, retried: [{ ...DATA.tests.retried[0]!, attempts: [{ attempt: 1, ended: 'failed', duration: 120, message: 'expected 1 to be 2', frame: 'src/flaky.test.ts:14' }, { attempt: 2, ended: 'passed', duration: 110 }] }] } }), 'src/flaky.test.ts');
    expect(flaky).toContain('sometimes &lt;fails&gt;');
    expect(flaky).toContain('failed');
    expect(flaky).toContain('120 ms');
    expect(flaky).toContain('expected 1 to be 2');
    expect(flaky).toContain('src/flaky.test.ts:14');
    expect(flaky).toContain('passed');
  });

  it('says a file holds no retried case where it holds none, rather than leaving the half empty', () => {
    expect(pane(viewPage(DATA), 'src/slow.test.ts')).toContain('no retried case');
  });

  it('gives a file its phases and its place on the timeline, or says it has none', () => {
    const slow = pane(viewPage(DATA), 'src/slow.test.ts');
    expect(slow).toContain('setup');
    expect(slow).toContain('200 ms');
    expect(slow).toContain('href="#timeline/src%2Fslow.test.ts"');
    expect(pane(viewPage(DATA), 'src/flaky.test.ts')).toContain('carries no start');
  });

  it('lists the source files a test file entered, each a link to Coverage', () => {
    const slow = pane(viewPage(DATA), 'src/slow.test.ts');
    expect(slow).toContain('href="#coverage/src%2Fworld.ts"');
    expect(slow).toContain('href="#coverage/src%2Fprice.ts"');
  });

  it('says how many it left out when the files it entered were cut', () => {
    const cut = { ...DATA, reach: { ...DATA.reach, tests: [{ file: 'src/slow.test.ts', reached: ['src/world.ts'], total: 40 }], files: [] } };
    expect(pane(viewPage(cut), 'src/slow.test.ts')).toContain('39 more');
  });

  it('draws a Coverage tab from the relation alone, where each file lists the tests that entered it and links back', () => {
    const html = viewPage(DATA);
    expect(html).toContain('data-tab="coverage"');
    const row = html.slice(html.indexOf('<tr data-key="src/price.ts"'));
    expect(row.slice(0, row.indexOf('</tr>'))).toContain('href="#test/src%2Fflaky.test.ts"');
    expect(row.slice(0, row.indexOf('</tr>'))).toContain('href="#test/src%2Fslow.test.ts"');
  });
});

describe('variance view arguments', () => {
  it('takes a suite and an output path, and no positional', () => {
    expect(parseViewArgs(readFlags(['--suite', 'unit'], 'view', ['--suite'], 'variance view'))).toEqual({ command: 'view', suite: 'unit' });
    expect(() => parseViewArgs(readFlags(['--out', 'a.html'], 'view', ['--suite'], 'variance view'))).toThrow();
    expect(() => parseViewArgs(readFlags(['x'], 'view', ['--suite'], 'variance view'))).toThrow();
  });
});
