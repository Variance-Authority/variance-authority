/**
 * A case's slowest statement is read by a report and by nothing that selects:
 * one record written with it and without it answers every change alike, read
 * in TypeScript and in the addon.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CrossingSets } from './crossing-sets.js';
import type { LineRange } from './diff-lines.js';
import { decodeExecutionIndex } from './execution-format.js';
import { narrowByJourneys } from './execution-select.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { selectJourneyFile } from './journey-native.js';
import type { ExecutionTest } from './reverse.js';

const UNTIMED: readonly ExecutionTest[] = [
  { id: 'a > one', file: 'test/a.test.ts', name: 'one', duration: 1400 },
  { id: 'a > two', file: 'test/a.test.ts', name: 'two', duration: 3 },
  { id: 'b > one', file: 'test/b.test.ts', name: 'one', duration: 250 },
];
const TIMED: readonly ExecutionTest[] = [
  { ...UNTIMED[0]!, slowest: { line: 12, time: 1200 } },
  UNTIMED[1]!,
  { ...UNTIMED[2]!, slowest: { line: 7, time: 249 } },
];

function record(tests: readonly ExecutionTest[]): Uint8Array {
  const sets = new CrossingSets(tests.length);
  return encodeSetExecutionIndex({
    tests,
    modules: [{
      file: 'src/api.ts',
      blocks: [
        { kind: 'module', name: '', path: '', startLine: 1, endLine: 10, source: true },
        { kind: 'function', name: 'get', path: 'get', startLine: 3, endLine: 6, source: true },
      ],
      called: Uint32Array.of(sets.intern([2]), sets.intern([0, 1])),
      loaded: Uint8Array.of(1, 0),
    }],
    sets: sets.pool(),
  });
}

function kept(bytes: Uint8Array): string {
  const file = join(mkdtempSync(join(tmpdir(), 'statement-time-select-')), 'journeys.bin');
  writeFileSync(file, bytes);
  return file;
}

const CHANGES: readonly (readonly [string, ReadonlyMap<string, readonly LineRange[]>])[] = [
  ['a region two cases entered', new Map([['src/api.ts', [{ start: 4, end: 4 }]]])],
  ['a load-time line', new Map([['src/api.ts', [{ start: 1, end: 1 }]]])],
  ['a whole file', new Map([['src/api.ts', []]])],
  ['a test file', new Map([['test/b.test.ts', []]])],
  ['a path nothing knows', new Map([['nowhere.ts', []]])],
];

describe('selection over a record that times its statements', () => {
  const [timed, untimed] = [record(TIMED), record(UNTIMED)];
  const [timedFile, untimedFile] = [kept(timed), kept(untimed)];

  it('writes the times into the one record and not the other', () => {
    expect(decodeExecutionIndex(timed).tests).toEqual(TIMED);
    expect(decodeExecutionIndex(untimed).tests).toEqual(UNTIMED);
  });

  it.each(CHANGES)('selects the same cases for %s, with the times and without', async (_, changed) => {
    const without = narrowByJourneys(decodeExecutionIndex(untimed), changed);

    expect(narrowByJourneys(decodeExecutionIndex(timed), changed)).toEqual(without);
    expect(await selectJourneyFile(timedFile, changed, {})).toEqual(await selectJourneyFile(untimedFile, changed, {}));
    expect(await selectJourneyFile(timedFile, changed, {})).toEqual(without);
  });
});
