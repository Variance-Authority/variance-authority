// The addon's lay, case by case.
//
// `layCoverage` lays a run over a record column to column. Every case the lay
// tells apart (`__fixtures__/layer-cases.ts`) is laid here, and the record it
// writes is read back and compared, line for line, with the record the case
// says it lays.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASES } from './__fixtures__/layer-cases.js';
import { BASELINE, LOCAL, at, rebuilt } from './__fixtures__/layer-shapes.js';
import { printed } from './__fixtures__/laid.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { instrumentationId } from '../instrument/index.js';
import { cutRecord, foreignProbes, layCoverage, layeredCoverage } from './format-layer.js';

describe('layCoverage', () => {
  for (const [what, { previous, current, onDisk, readings, laid }] of Object.entries(CASES)) {
    it(`lays ${what}`, () => {
      const bytes = previous === undefined ? undefined : encodeTestCoverage(previous);

      expect(printed(decodeTestCoverage(layCoverage(bytes, current, onDisk, readings)))).toEqual(laid);
    });
  }

  it('keeps a carried test whole over another build of the text it ran', () => {
    // The layer is what CI writes with: a one-file shard that loaded the
    // `dist` build of a module, layered over a mainline that holds the `src`
    // build of the same text, must not send the mainline's tests back to run.
    const layered = decodeTestCoverage(layCoverage(
      encodeTestCoverage(at(BASELINE, 'test/alpha.test.ts')),
      rebuilt(at(LOCAL, 'test/beta.test.ts')),
    ));

    expect(layered.tests.every((test) => test.complete)).toBe(true);
  });

  it('refuses a record it cannot read, with the reason', () => {
    // One build reads what it wrote. A record it cannot read is another
    // build's, and laying over it as if it were absent would drop its evidence.
    expect(() => layCoverage(Buffer.from('not a snapshot'), at(LOCAL, 'test/beta.test.ts'))).toThrow(/not a variance-authority journey artifact/);
  });

  it('refuses a record under other probes, naming both', () => {
    const previous = { ...at(BASELINE, 'test/alpha.test.ts'), instrumentation: 'another-recipe' };

    expect(() => layCoverage(encodeTestCoverage(previous), at(LOCAL, 'test/beta.test.ts')))
      .toThrow(/`another-recipe`.*`fixture-instrumentation`/);
  });

  it('carries strings no comparison of bytes could order', () => {
    // UTF-8 byte order and UTF-16 code unit order part company above U+E000,
    // and the dictionary is sorted by the second. A module named past that line
    // is what sends the lay back to comparing strings, so one is written here
    // rather than assumed never to exist.
    const previous = at(BASELINE, 'test/alpha.test.ts', ['src/\u{1f600}.ts', 'src/\ue001.ts']);
    const current = at(LOCAL, 'test/beta.test.ts', ['src/decide.ts']);

    expect(decodeTestCoverage(layCoverage(encodeTestCoverage(previous), current)).modules.map((module) => module.file))
      .toEqual(['src/decide.ts', 'src/\u{1f600}.ts', 'src/\ue001.ts']);
  });
});

describe('foreignProbes', () => {
  it('names the probes of a record the lay refuses for its probes, and nothing for one it lays over', () => {
    const current = at(LOCAL, 'test/beta.test.ts');
    const other = encodeTestCoverage({ ...at(BASELINE, 'test/alpha.test.ts'), instrumentation: 'another-recipe' });
    const same = encodeTestCoverage(at(BASELINE, 'test/alpha.test.ts'));

    expect(foreignProbes(other, current.instrumentation)).toBe('another-recipe');
    expect(() => layCoverage(other, current)).toThrow(/`another-recipe`/);
    expect(foreignProbes(same, current.instrumentation)).toBeUndefined();
    expect(() => layCoverage(same, current)).not.toThrow();
  });

  it('leaves a record it cannot read to the caller, and asks nothing of a run that lays no coverage', () => {
    const other = encodeTestCoverage({ ...at(BASELINE, 'test/alpha.test.ts'), instrumentation: 'another-recipe' });

    expect(foreignProbes(Buffer.from('not a snapshot'), 'fixture-instrumentation')).toBeUndefined();
    expect(foreignProbes(other, undefined)).toBeUndefined();
  });
});

describe('layeredCoverage', () => {
  it('writes the run alone where no record is, and refuses one it cannot read, naming the file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'layered-'));
    try {
      const file = join(root, 'coverage.bin');
      const current = at(LOCAL, 'test/beta.test.ts');
      expect(printed(decodeTestCoverage(await layeredCoverage(file, current, root)))).toEqual(printed(current));

      await writeFile(file, 'not a snapshot');
      await expect(layeredCoverage(file, current, root)).rejects.toThrow(file);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('cutRecord', () => {
  it('holds a module as not instrumented under the loads recipe, which cuts nothing', () => {
    const text = 'export function f(x) { if (x) { return 1; } return 2; }';
    const { modules } = decodeTestCoverage(cutRecord(instrumentationId('loads'), new Map([['f.ts', text]])));

    expect(modules.map((module) => [module.file, module.instrumented, module.blocks])).toEqual([['f.ts', false, []]]);
  });
});
