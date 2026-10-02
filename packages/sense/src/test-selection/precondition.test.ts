import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseSync } from 'oxc-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import preconditions from './case-preconditions.cjs';
import { variancePrecondition } from './precondition.js';

const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');
const realm = globalThis as { [PRECONDITION]?: unknown };

// The suite may itself run under a recording, which installed its own recorder.
let recording: unknown;
beforeEach(() => {
  recording = realm[PRECONDITION];
  delete realm[PRECONDITION];
});
afterEach(() => {
  if (recording === undefined) delete realm[PRECONDITION];
  else realm[PRECONDITION] = recording;
});

describe('variancePrecondition with no recording', () => {
  it('does nothing, and costs a property read', () => {
    expect(realm[PRECONDITION]).toBeUndefined();
    expect(() => variancePrecondition('network', 'mocked')).not.toThrow();
    const started = performance.now();
    for (let at = 0; at < 100_000; at += 1) variancePrecondition('network', 'mocked');
    // A property read and a type check, measured: well under a microsecond a call.
    expect((performance.now() - started) / 100_000).toBeLessThan(0.001);
  });

  it('imports nothing, so it runs wherever a test does', async () => {
    const source = await readFile(new URL('./precondition.ts', import.meta.url), 'utf8');
    const parsed = parseSync('precondition.ts', source, { sourceType: 'module' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.module.staticImports).toEqual([]);
    expect(parsed.module.dynamicImports).toEqual([]);
  });

  it('swallows a recorder that throws', () => {
    realm[PRECONDITION] = () => {
      throw new Error('the recorder is broken');
    };
    expect(() => variancePrecondition('network', 'mocked')).not.toThrow();
  });
});

describe('the recorder a case scope installs', () => {
  const keyOf = (name: string): string => `/repo/a.test.ts\u0000${name}\u00001`;
  const nameOf = (key: string): { file: string; name: string } => {
    const [file = '', name = ''] = key.split('\u0000');
    return { file, name };
  };

  it('puts a call in a case body on that case, at the case level, with the line that said it', () => {
    let running: string | undefined = keyOf('pays');
    const recorder = preconditions.recorder(globalThis, () => running, nameOf);
    variancePrecondition('network', 'mocked'); const line = new Error().stack!.split('\n')[1]!;
    variancePrecondition({ flag: 'ff-on', seeded: true });
    running = undefined;
    const said = recorder.take(keyOf('pays'));
    expect(said.map(([name, value, , level]) => [name, value, level])).toEqual([
      ['network', 'mocked', preconditions.CASE_LEVEL],
      ['flag', 'ff-on', preconditions.CASE_LEVEL],
      ['seeded', true, preconditions.CASE_LEVEL],
    ]);
    const site = said[0]![2];
    expect(line).toContain(site);
    expect(site).toMatch(/precondition\.test\.ts:\d+$/);
  });

  it('reaches only the cases under the describe that said it, and the file reaches all', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined, nameOf);
    recorder.phase({ kind: 'scope', depth: 0, prefix: '' });
    variancePrecondition('flag', 'ff-off');
    recorder.phase({ kind: 'scope', depth: 1, prefix: 'checkout > ' });
    variancePrecondition('network', 'mocked');
    recorder.phase(undefined);
    const names = (key: string): unknown[] => recorder.take(key).map(([name, value]) => `${name}=${String(value)}`);
    expect(names(keyOf('checkout > pays'))).toEqual(['flag=ff-off', 'network=mocked']);
    expect(names(keyOf('refunds > pays'))).toEqual(['flag=ff-off']);
  });

  it('gives a beforeEach that names no case to the next case that opens', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined, nameOf);
    recorder.within({ kind: 'each', depth: 1 }, () => variancePrecondition('network', 'mocked'));
    recorder.entered(keyOf('checkout > pays'));
    recorder.entered(keyOf('checkout > refunds'));
    expect(recorder.take(keyOf('checkout > pays')).map(([name, , , level]) => [name, level])).toEqual([['network', 1]]);
    expect(recorder.take(keyOf('checkout > refunds'))).toEqual([]);
  });

  it('records no case for a call after the case, and says where it was', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined, nameOf);
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
    try {
      recorder.within({ kind: 'after' }, () => variancePrecondition('network', 'mocked'));
    } finally {
      console.warn = warn;
    }
    expect(recorder.take(keyOf('pays'))).toEqual([]);
    expect(String(warned[0])).toMatch(/precondition\.test\.ts:\d+ ran after its case/);
  });

  it('refuses a value that is not a string, number or boolean, and records nothing', () => {
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'), nameOf);
    const warn = console.warn;
    console.warn = () => {};
    try {
      variancePrecondition('when', new Date() as unknown as string);
    } finally {
      console.warn = warn;
    }
    expect(recorder.take(keyOf('pays'))).toEqual([]);
  });
});

describe('resolving what a case said', () => {
  const said = (name: string, value: string | boolean, level: number, site = 'a.test.ts:1') =>
    [name, value, site, level] as const;

  it('lets a narrower level override a wider one', () => {
    expect(preconditions.resolve([
      said('flag', 'ff-off', 0, 'a.test.ts:1'),
      said('flag', 'ff-on', preconditions.CASE_LEVEL, 'a.test.ts:9'),
    ])).toEqual([{ name: 'flag', value: 'ff-on', site: 'a.test.ts:9' }]);
  });

  it('keeps two values said at one level, and reports them as a contradiction', () => {
    const resolved = preconditions.resolve([
      said('flag', 'ff-on', 1, 'a.test.ts:4'),
      said('flag', 'ff-off', 1, 'a.test.ts:5'),
      said('flag', 'ff-on', 1, 'a.test.ts:7'),
    ]);
    expect(resolved).toEqual([
      { name: 'flag', value: 'ff-off', site: 'a.test.ts:5' },
      { name: 'flag', value: 'ff-on', site: 'a.test.ts:4' },
    ]);
    expect(preconditions.contradictions(resolved)).toEqual(['flag']);
  });

  it('carries what a frame said in its owner, and tells a silent frame from one that never listened', () => {
    const owner = 'a.test.ts\u0000pays\u00001';
    const packed = preconditions.packSaid(owner, [said('network', 'mocked', 0)]);
    expect(preconditions.saidOf(packed)).toEqual([said('network', 'mocked', 0)]);
    expect(preconditions.saidOf(preconditions.packSaid(owner, []))).toEqual([]);
    expect(preconditions.saidOf(owner)).toBeUndefined();
    expect(packed.split('\u0000').slice(0, 3)).toEqual(['a.test.ts', 'pays', '1']);
  });
});
