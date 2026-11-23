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

/** What a reader sees of the element carrying `data-row="<row>"`: its text, tags dropped and spaces collapsed. */
function row(html: string, name: string): string {
  const at = html.indexOf(`data-row="${name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`);
  expect(at, `no element carries data-row="${name}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', at);
  const tag = /^<(\w+)/u.exec(html.slice(start))![1]!;
  const end = html.indexOf(`</${tag}>`, at);
  return seen(html.slice(start, end));
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

  it('gives each suite its run, load-only and unloaded regions, and what changed them since the base', () => {
    expect(row(html, 'suite:unit')).toContain('60.0%');
    expect(row(html, 'suite:unit')).toContain('+2 newly run');
    expect(row(html, 'suite:unit')).toContain('cc25d6a6');
    expect(row(html, 'suite:integration')).toContain('30.0%');
    expect(row(html, 'suite:integration')).toContain('no base: integration is not given to the share');
    expect(row(html, 'suite:checkout')).toContain('unrecorded');
  });

  it('shows what each kind runs alone and what several kinds share', () => {
    expect(row(html, 'kinds:several')).toContain('200');
    expect(row(html, 'kind:unit')).toContain('400');
    expect(row(html, 'kind:integration')).toContain('100');
    expect(row(html, 'fan-in:unit')).toContain('120');
  });

  it('lists every package with its files, and the tests that enter each file by kind', () => {
    expect(row(html, 'package:packages/cli')).toContain('70.0%');
    expect(row(html, 'package:packages/core')).toContain('90.0%');
    expect(row(html, 'file:packages/cli/src/a.ts')).toContain('14');
    expect(row(html, 'file:packages/cli/src/a.ts')).toContain('unit 12');
    expect(row(html, 'file:packages/cli/src/<b>.ts')).toContain('0');
    expect(html).not.toContain('<b>.ts');
  });

  it('lists every directory no suite loads, not the first five', () => {
    for (const { directory } of DIRECTORIES) expect(row(html, `unloaded:${directory}`)).toContain(directory);
  });
});

describe('--format html', () => {
  const parse = (...argv: string[]) => parseCoverageArgs(readFlags(argv, 'coverage', ['--format', '--from', '--fan-in', '--packages']));

  it('counts each package and its fan-in, since the page lists both', () => {
    expect(parse('--format', 'html')).toMatchObject({ format: 'html', fanIn: true, packages: true });
  });

  it('counts the one directory `--from` names, and no package', () => {
    expect(parse('--format', 'html', '--from', 'packages/cli')).not.toHaveProperty('packages');
  });

  it('is named among the formats a wrong one is refused with', () => {
    expect(() => parse('--format', 'pdf')).toThrow('--format must be text, markdown, json, badge or html, not `pdf`');
  });
});
