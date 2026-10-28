import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The VS Code client's reading of `variance covering --format json`, on the
 * fixtures the WebStorm client's check reads too (`editors/webstorm/build.sh` runs that check).
 */

const editors = join(import.meta.dirname, '../../../editors');
const { atLine, marksOf, suitesOf } = createRequire(import.meta.url)(join(editors, 'vscode/record.js'));
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(editors, 'fixtures', name), 'utf8'));

const suites = fixture('covering-suites.json');
const placed = (marks: readonly { suites?: readonly string[]; startLine: number; endLine: number; state?: string }[]) =>
  marks.map((mark) => `${mark.suites?.join('+') ?? '-'} ${mark.startLine}-${mark.endLine} ${mark.state ?? 'entered'}`);

describe('a repository that declares suites', () => {
  it('reads every suite, in the order the CLI answered', () => {
    expect(suitesOf(suites).map((one: { suite: string; kind: string; refused?: string }) => [one.suite, one.kind, one.refused]))
      .toEqual([
        ['unit', 'unit', undefined],
        ['integration', 'integration', undefined],
        ['chromium', 'e2e', 'unloaded'],
        ['site', 'e2e', 'unrecorded'],
        ['visual', 'visual', undefined],
      ]);
  });

  it('paints the one mark the CLI read each run of lines as, across every suite that ran it', () => {
    expect(placed(marksOf(suites))).toEqual([
      'unit+integration 1-4 walked',
      'unit 6-8 alone',
      'unit 10-12 hole',
      'integration 14-15 unwalked',
    ]);
  });

  it('answers a line with every suite that ran it, nearest first, and every suite that could not answer', () => {
    const { answered, refused } = atLine(suites, 2);
    expect(answered.map((one: { suite: string; kind: string; range: { state: string } }) => `${one.suite} (${one.kind}) ${one.range.state}`))
      .toEqual(['unit (unit) walked', 'integration (integration) loaded']);
    expect(refused.map((one: { suite: string; refused?: string }) => `${one.suite} ${one.refused}`))
      .toEqual(['chromium unloaded', 'site unrecorded']);
    expect(atLine(suites, 13).answered).toEqual([]);
  });

  it('reads a line asked of every suite', () => {
    const line = suitesOf(fixture('covering-line-suites.json'));
    expect(line.map((one: { suite: string; state?: string; tests?: readonly unknown[] }) => [one.suite, one.state, one.tests?.length]))
      .toEqual([
        ['unit', 'walked', 2],
        ['integration', 'loaded', 1],
        ['chromium', undefined, undefined],
      ]);
  });
});

describe('a repository that declares no suites', () => {
  const one = {
    file: 'src/sum.ts',
    ranges: [{ startLine: 1, endLine: 4, tests: [], state: 'unwalked' }],
    frame: 'mapped',
  };

  it('reads its one answer as one suite without a name', () => {
    expect(suitesOf(one)).toEqual([one]);
    expect(placed(marksOf(one))).toEqual(['- 1-4 unwalked']);
  });

  it('paints nothing from a stale record, which places no range', () => {
    expect(marksOf({ file: 'src/sum.ts', frame: 'stale', from: 'coverage.bin' })).toEqual([]);
  });
});
