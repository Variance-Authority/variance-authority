import { describe, expect, it } from 'vitest';
import type { SuiteChange } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoverageArgs } from '../coverage-args.js';
import { formatCoverage } from './coverage-text.js';
import type { CoverageSource } from './coverage-source.js';
import type { Coverage } from './coverage.js';

const CHANGE: SuiteChange = {
  gained: 2, lost: 0, hidden: 0, unmeasured: 0, thinned: 0,
  written: { regions: 0, run: 0 }, deleted: { regions: 0, run: 0 },
  arrived: { regions: 0, run: 0, files: [] }, departed: { regions: 0, run: 0, files: [], ran: [] }, testFiles: [],
};

function source(regions: number, ran: number): CoverageSource {
  const unloaded = { files: 0, lines: 0, bytes: 0, regions: 0, uncut: 0, directories: [], list: [] };
  return { seeds: 'entrypoints', files: 0, unloaded, ran, regions } as unknown as CoverageSource;
}

const DIRECTORIES = ['tools/', 'scripts/', 'cases/a/', 'cases/b/', 'cases/c/', 'examples/'].map((directory, at) => ({
  directory, files: 1, lines: 100, regions: 60 - at * 10,
}));

const ANSWER: Coverage = {
  at: '0b5b312c',
  count: {
    regions: 1000, files: 20, run: 700, load: 50, none: 250, unjoined: 0,
    suites: [
      { name: 'unit', kind: 'unit', run: 600, load: 40, regions: 900 },
      { name: 'integration', kind: 'integration', run: 300, load: 60, regions: 500 },
    ],
    overlap: { several: 200, alone: { unit: 400, integration: 100 } },
  },
  suites: [
    { suite: 'unit', kind: 'unit', from: 'unit.bin', recorded: '0b5b312c', base: { from: 'base.bin', commit: 'cc25d6a6', change: CHANGE } },
    { suite: 'integration', kind: 'integration', from: 'integration.bin', baseMissed: 'no base: integration is not given to the share' },
    { suite: 'checkout', kind: 'e2e' },
  ],
  source: {
    ...source(1120, 700),
    files: 60,
    unloaded: { files: 6, lines: 600, bytes: 30000, regions: 210, uncut: 0, directories: DIRECTORIES, list: [] },
  },
  entries: [
    { from: 'packages/cli', own: source(300, 210), uses: source(800, 500) },
    { from: 'packages/core', own: source(200, 180), uses: source(200, 180) },
  ],
  ownership: [
    { file: 'packages/cli/src/a.ts', owner: 'packages/cli', regions: 40, run: 30, own: 25, others: 5, by: { 'packages/core': 5 }, kinds: { unit: 25 } },
    { file: 'packages/cli/src/<b>.ts', owner: 'packages/cli', regions: 10, run: 0, own: 0, others: 0, by: {}, kinds: {} },
    { file: 'packages/core/src/c.ts', owner: 'packages/core', regions: 200, run: 180, own: 180, others: 0, by: {}, kinds: { unit: 180 } },
  ],
  fanIn: {
    kinds: [
      { kind: 'unit', testFiles: 120, regions: 600, one: 150, median: 2, p90: 9, max: 40 },
      { kind: 'integration', testFiles: 12, regions: 300, one: 30, median: 1, p90: 3, max: 8 },
    ],
    files: [
      { file: 'packages/cli/src/<b>.ts', regions: 10, run: 0, one: 0, entered: 0, peak: 0, median: 0, testFiles: 132, share: 0 },
      { file: 'packages/cli/src/a.ts', regions: 40, run: 30, one: 6, entered: 14, by: { unit: 12, integration: 2 }, peak: 9, median: 3, testFiles: 132, share: 0.106, duration: 0.08 },
      { file: 'packages/core/src/c.ts', regions: 200, run: 180, one: 20, entered: 7, by: { unit: 7 }, peak: 7, median: 2, testFiles: 132, share: 0.053 },
    ],
  },
};

/** The markup of the element carrying `data-row="<row>"`. */
function raw(html: string, name: string): string {
  const at = html.indexOf(`data-row="${name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`);
  expect(at, `no element carries data-row="${name}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', at);
  const tag = /^<(\w+)/u.exec(html.slice(start))![1]!;
  return html.slice(start, html.indexOf(`</${tag}>`, at));
}

/** What a reader sees of the element carrying `data-row="<row>"`: its text, tags dropped and spaces collapsed. */
function row(html: string, name: string): string {
  return seen(raw(html, name));
}

function seen(html: string): string {
  return html.replace(/<[^>]*>/gu, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').replace(/\s+/gu, ' ').trim();
}

describe('the coverage page', () => {
  const html = formatCoverage(ANSWER, 'html');

  it('is one page that fetches nothing, in the visual review page\'s palette', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=/u);
    expect(html).toContain('--orange:#ff4a19');
    expect(html).toContain('<path fill="#ff4a19"');
  });

  it('leads with what any suite ran, at the commit it was counted', () => {
    expect(row(html, 'lead')).toContain('70.0%');
    expect(row(html, 'lead')).toContain('700 of 1,000 regions');
    expect(seen(html)).toContain('0b5b312c');
  });

  it('parts what ran by the text it ran over, so the bar adds up to the lead', () => {
    const over = { this: 640, older: 50, notKnown: 10, why: ['the record names no commit'] };
    const parted = formatCoverage({ ...ANSWER, count: { ...ANSWER.count, over } }, 'html');
    expect(row(parted, 'lead')).toContain('64.0%');
    const census = row(parted, 'census');
    expect(census).toContain('640 run over this text');
    expect(census).toContain('50 run over an older text');
    expect(census).toContain('10 run over a text not known');
    expect(census).not.toContain('run by a case');
    expect(parted).toContain('the record names no commit');
  });

  it('gives each suite its run, load-only and loaded regions, and what changed them since the base', () => {
    expect(row(html, 'suite:unit')).toContain('60.0%');
    expect(row(html, 'suite:unit')).toContain('40');
    expect(row(html, 'suite:unit')).toContain('900');
    expect(row(html, 'suite:unit')).toContain('+2 newly run');
    expect(row(html, 'suite:unit')).toContain('cc25d6a6');
    expect(row(html, 'suite:integration')).toContain('30.0%');
    expect(row(html, 'suite:integration')).toContain('no base: integration is not given to the share');
    expect(row(html, 'suite:checkout')).toContain('unrecorded');
    expect(seen(html)).toContain('regions run only at load loaded');
  });

  it('names the regions it could not join across suites', () => {
    expect(seen(html)).not.toContain('could not be joined');
    const split = formatCoverage({ ...ANSWER, count: { ...ANSWER.count, unjoined: 3 } }, 'html');
    expect(seen(split)).toContain('3 regions could not be joined across suites.');
  });

  it('says in its lead what --at-distance narrowed the count to', () => {
    const banded = formatCoverage({ ...ANSWER, atDistance: { from: 1, to: 2, unplaced: ['a.test.ts'], unmeasured: 0 } }, 'html');
    expect(row(banded, 'lead')).toContain('counted where the nearest test that ran the code is 1-2 import hops away');
    expect(row(banded, 'lead')).toContain('1 test file not on the import graph left out');
  });

  it('shows what each kind runs alone and what several kinds share', () => {
    expect(row(html, 'kinds:several')).toContain('200');
    expect(row(html, 'kind:unit')).toContain('400');
    expect(row(html, 'kind:integration')).toContain('100');
    expect(row(html, 'fan-in:unit')).toContain('120');
    expect(row(html, 'fan-in:unit')).toContain('25.0%');
    expect(html).toContain('id="Kinds"');
  });

  it('lists every package with its files, and the tests that cover each file by kind', () => {
    expect(row(html, 'package:packages/cli')).toContain('70.0%');
    expect(row(html, 'package:packages/core')).toContain('90.0%');
    expect(row(html, 'file:packages/cli/src/a.ts')).toContain('14');
    expect(row(html, 'file:packages/cli/src/a.ts')).toContain('unit 12');
    expect(row(html, 'file:packages/cli/src/<b>.ts')).toContain('0');
    expect(html).not.toContain('<b>.ts');
    expect(html).toContain('id="Packages"');
  });

  it('lists each directory an entry point declares, with no files, when it was not asked for packages', () => {
    const { ownership: _, ...bare } = ANSWER;
    const entries = formatCoverage(bare, 'html');
    expect(row(entries, 'package:packages/cli')).toContain('70.0%');
    expect(row(entries, 'package:packages/core')).toContain('90.0%');
    expect(entries).not.toContain('<details class="package"');
  });

  it('lists every directory no suite loads, not the first five', () => {
    for (const { directory } of DIRECTORIES) expect(row(html, `unloaded:${directory}`)).toContain(directory);
    expect(html).toContain('id="Not-loaded"');
  });

  it('names a package it could not count, and lists a file no package owns after every package', () => {
    const root = { file: 'scripts/x.ts', owner: '.', regions: 4, run: 2, own: 2, others: 0, by: {}, kinds: {} };
    const gone = { file: 'packages/gone/y.ts', owner: 'packages/gone', regions: 3, run: 1, own: 1, others: 0, by: {}, kinds: {} };
    const wider = formatCoverage({
      ...ANSWER,
      entries: [...ANSWER.entries!, { from: 'packages/gone', missed: 'the index holds nothing under it' }],
      ownership: [...ANSWER.ownership!, gone, root],
    }, 'html');
    expect(row(wider, 'package:packages/gone')).toContain('the index holds nothing under it');
    expect(wider.split('data-row="package:packages/gone"')).toHaveLength(2);
    expect(row(wider, 'file:packages/gone/y.ts')).toContain('1 / 3');
    expect(row(wider, 'package:.')).toContain('1 file');
    expect(row(wider, 'package:.')).not.toContain('1 files');
    expect(wider.indexOf('data-row="package:."')).toBeGreaterThan(wider.indexOf('data-row="package:packages/core"'));
  });

  it('says how many unloaded files did not parse, so their regions are not counted', () => {
    const unparsed = formatCoverage({ ...ANSWER, source: { ...ANSWER.source!, unloaded: { ...ANSWER.source!.unloaded, uncut: 1 } } }, 'html');
    expect(seen(unparsed)).toContain('1 file did not parse, so no regions are counted for them');
    expect(seen(html)).not.toContain('did not parse');
  });

  it('says why it could not count what no suite loads', () => {
    const { source: _, ...unsourced } = ANSWER;
    const missed = formatCoverage({ ...unsourced, sourceMissed: 'the index is not built' }, 'html');
    expect(missed).toContain('id="Not-loaded"');
    expect(seen(missed)).toContain('not counted, because the index is not built');
  });
});

describe('the coverage page of one directory', () => {
  const empty = { file: 'packages/cli/src/empty.ts', regions: 0, run: 0, one: 0, entered: 0, peak: 0, median: 0, testFiles: 1, share: 0 };
  const html = formatCoverage({
    at: '0b5b312c',
    count: { regions: 40, files: 2, run: 30, load: 0, none: 10, unjoined: 0, suites: [{ name: 'unit', kind: 'unit', run: 30, load: 0, regions: 40 }] },
    suites: [{ suite: 'unit', kind: 'unit', from: 'unit.bin', recorded: '1234567890ab' }],
    source: source(40, 30),
    fanIn: { kinds: [], files: [ANSWER.fanIn!.files[1]!, empty] },
  }, 'html');

  it('lists the files a suite loaded, with no package', () => {
    expect(row(html, 'file:packages/cli/src/a.ts')).toContain('30 / 40');
    expect(html).not.toContain('id="Packages"');
  });

  it('draws no ratio and no meter for a file with no region', () => {
    const cells = raw(html, 'file:packages/cli/src/empty.ts').split('<td');
    expect(seen(`<td${cells[2]!}`)).toBe('—');
    expect(raw(html, 'file:packages/cli/src/empty.ts')).not.toContain('class="meter"');
    expect(raw(html, 'file:packages/cli/src/empty.ts')).not.toContain('NaN');
  });

  it('names the directory --from counted, and how it chose the files', () => {
    const scoped = formatCoverage({
      ...ANSWER, entries: undefined, ownership: undefined,
      source: { ...source(40, 30), from: 'packages/payments', files: 3 },
    }, 'html');
    const header = seen(scoped.slice(scoped.indexOf('<header>'), scoped.indexOf('</header>')));
    expect(header).toContain('from packages/payments');
    expect(scoped).toContain('title="reached from the entry points of packages/payments"');
    expect(seen(html.slice(html.indexOf('<header>'), html.indexOf('</header>')))).not.toContain('from ');
  });

  it('says when a suite with no base was recorded', () => {
    expect(row(html, 'suite:unit')).toContain('recorded at 12345678');
  });

  it('leaves out the kinds where one kind ran and no test file entered, and the unloaded where everything loaded', () => {
    expect(html).not.toContain('id="Kinds"');
    expect(html).not.toContain('id="Not-loaded"');
  });
});

describe('--format html', () => {
  const parse = (...argv: string[]) => parseCoverageArgs(readFlags(argv, 'coverage', ['--format', '--from', '--fan-in', '--packages', '--session']));

  it('draws what the flags count, and counts nothing they do not ask for', () => {
    const page = parse('--format', 'html');
    expect(page).toMatchObject({ format: 'html' });
    expect(page).not.toHaveProperty('packages');
    expect(page).not.toHaveProperty('fanIn');
    expect(parse('--format', 'html', '--packages', '--fan-in')).toMatchObject({ format: 'html', packages: true, fanIn: true });
  });

  it('refuses a session, which the page does not draw', () => {
    expect(() => parse('--format', 'html', '--session', 'mine=cov.json')).toThrow('`--format html` draws no session; pass `--session` with `--format text`, `markdown` or `json`.');
  });

  it('is named among the formats a wrong one is refused with', () => {
    expect(() => parse('--format', 'pdf')).toThrow('--format must be text, markdown, json, badge or html, not `pdf`');
  });
});
