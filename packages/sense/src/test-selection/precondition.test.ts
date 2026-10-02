import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseSync } from 'oxc-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutSaid } from './case-precondition-column.js';
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

  it('puts a call in a case body on that case, at the case level, with the line that said it', () => {
    let running: string | undefined = keyOf('pays');
    const recorder = preconditions.recorder(globalThis, () => running);
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

  it('throws for a call where no case is running, through the entry, with the line that made it', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    expect(() => variancePrecondition('flag', 'ff-off')).toThrow(
      /variancePrecondition at \S*precondition\.test\.ts:\d+ ran outside a running case/,
    );
    recorder.phase({ kind: 'outside', because: 'ran in a beforeAll, which runs for no one case' });
    expect(() => variancePrecondition('flag', 'ff-off')).toThrow(/ran in a beforeAll/);
    recorder.phase(undefined);
    expect(recorder.take(keyOf('pays'))).toEqual([]);
  });

  it('forgets what a beforeEach said for a case that never entered when the next case begins', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    recorder.begin();
    recorder.within({ kind: 'each', depth: 1 }, () => variancePrecondition('doomed'));
    recorder.begin();
    recorder.within({ kind: 'each', depth: 0 }, () => variancePrecondition('network', 'live'));
    recorder.entered(keyOf('after doomed > pays'));
    expect(recorder.take(keyOf('after doomed > pays')).map(([name]) => name)).toEqual(['network']);
  });

  it('keeps the beforeEach of one context apart from another', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    const left = {};
    const right = {};
    recorder.within({ kind: 'each', depth: 1, token: left }, () => variancePrecondition('lane', 'left'));
    recorder.within({ kind: 'each', depth: 1, token: right }, () => variancePrecondition('lane', 'right'));
    recorder.entered(keyOf('right'), right);
    recorder.entered(keyOf('left'), left);
    expect(recorder.take(keyOf('left')).map(([, value]) => value)).toEqual(['left']);
    expect(recorder.take(keyOf('right')).map(([, value]) => value)).toEqual(['right']);
  });

  it('gives a beforeEach that names no case to the next case that opens', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    recorder.within({ kind: 'each', depth: 1 }, () => variancePrecondition('network', 'mocked'));
    recorder.entered(keyOf('checkout > pays'));
    recorder.entered(keyOf('checkout > refunds'));
    expect(recorder.take(keyOf('checkout > pays')).map(([name, , , level]) => [name, level])).toEqual([['network', 1]]);
    expect(recorder.take(keyOf('checkout > refunds'))).toEqual([]);
  });

  it('records no case for a call after the case, and says where it was', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
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
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'));
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

describe('where a hook stands, and what the recorder takes for a call', () => {
  const keyOf = (name: string): string => `/repo/a.test.ts\u0000${name}\u00001`;
  const each = (name: string) => ({ kind: 'each', depth: 1, case: keyOf(name) }) as const;
  const outside = /ran outside a running case/;

  it('lays a beforeEach that names its case on that case, through the async store where the realm has one', async () => {
    const recorder = preconditions.recorder(globalThis, () => undefined, new AsyncLocalStorage());
    await recorder.within(each('pays'), async () => {
      await Promise.resolve();
      variancePrecondition('network', 'mocked');
    });
    expect(() => variancePrecondition('flag')).toThrow(outside);
    expect(recorder.take(keyOf('pays')).map(([name, value, , level]) => [name, value, level])).toEqual([['network', 'mocked', 1]]);
  });

  it('stands back where it was once a hook returns, throws, resolves or rejects', async () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    expect(() => recorder.within(each('pays'), () => {
      throw new Error('the hook failed');
    })).toThrow('the hook failed');
    expect(() => variancePrecondition('flag')).toThrow(outside);

    await recorder.within(each('pays'), async () => {
      await Promise.resolve();
      variancePrecondition('flag', 'ff-on');
    });
    expect(() => variancePrecondition('flag')).toThrow(outside);

    await expect(recorder.within(each('pays'), async () => {
      await Promise.resolve();
      throw new Error('the async hook failed');
    })).rejects.toThrow('the async hook failed');
    expect(() => variancePrecondition('flag')).toThrow(outside);
    expect(recorder.take(keyOf('pays')).map(([, value]) => value)).toEqual(['ff-on']);
  });

  it('forgets every case and every pending beforeEach when its file finishes', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    recorder.within(each('pays'), () => variancePrecondition('network', 'mocked'));
    recorder.within({ kind: 'each', depth: 0 }, () => variancePrecondition('seeded'));
    recorder.finish();
    recorder.entered(keyOf('refunds'));
    expect(recorder.take(keyOf('pays'))).toEqual([]);
    expect(recorder.take(keyOf('refunds'))).toEqual([]);
  });

  it('records nothing for an empty name, a record with a value beside it, or a record holding an empty name or an object', () => {
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'));
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
    try {
      variancePrecondition('');
      (variancePrecondition as (named: unknown, value?: unknown) => void)({ flag: 'ff-on' }, 'ff-off');
      variancePrecondition({ '': 'ff-on' });
      variancePrecondition({ when: {} as unknown as string });
    } finally {
      console.warn = warn;
    }
    expect(warned).toHaveLength(4);
    expect(recorder.take(keyOf('pays'))).toEqual([]);
  });

  it('names a call it cannot place on a stack as no site, and a dev server\'s `/@fs/` URL as the file it serves', () => {
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'));
    const say = realm[PRECONDITION] as (named: string, value: unknown, called: unknown) => void;
    say('none', true, undefined);
    say('short', true, { stack: 'Error\n    at entry (/repo/precondition.js:1:1)' });
    say('served', true, {
      stack: 'Error\n    at entry (http://localhost:5173/@fs/repo/precondition.js:1:1)\n' +
        '    at http://localhost:5173/@fs/repo/test/a.test.ts?v=1:4:7',
    });
    say('named', true, {
      stack: 'entry@http://localhost:5173/@fs/repo/precondition.js:1:1\n' +
        'pays@http://localhost:5173/@fs/repo/test/a.test.ts:9:3',
    });
    say('rooted', true, {
      stack: 'Error\n    at entry (http://localhost:5173/precondition.js:1:1)\n' +
        '    at http://localhost:5173/test/a.test.ts:2:5',
    });
    const said = recorder.take(keyOf('pays'));
    expect(said.map(([name, , site]) => [name, site])).toEqual([
      ['none', ''],
      ['short', ''],
      ['served', 'http://localhost:5173/@fs/repo/test/a.test.ts?v=1:4'],
      ['named', 'http://localhost:5173/@fs/repo/test/a.test.ts:9'],
      ['rooted', 'http://localhost:5173/test/a.test.ts:2'],
    ]);
    // A site served from the dev server's root keeps its URL: the FIXME at `checkoutSite`.
    expect(checkoutSaid('/repo', said).map(([, , site]) => site)).toEqual([
      '', '', 'test/a.test.ts:4', 'test/a.test.ts:9', 'http://localhost:5173/test/a.test.ts:2',
    ]);
  });

  it('refuses a frame owner whose sixth field is not a list of calls', () => {
    expect(() => preconditions.saidOf('a.test.ts\u0000pays\u00001\u0000\u0000\u0000{}')).toThrow(/not a variance-authority case journal/);
  });
});

describe('resolving what a case said', () => {
  const said = (name: string, value: string | boolean, level: number, site = 'a.test.ts:1') =>
    [name, value, site, level] as const;

  it('lets a narrower level override a wider one', () => {
    expect(preconditions.resolve([
      said('flag', 'ff-off', 0, 'a.test.ts:1'),
      said('flag', 'ff-on', preconditions.CASE_LEVEL, 'a.test.ts:9'),
    ])).toEqual([{ name: 'flag', value: 'ff-on', site: 'a.test.ts:9', level: preconditions.CASE_LEVEL }]);
  });

  it('keeps two values said at one level, and reports them as a contradiction', () => {
    const resolved = preconditions.resolve([
      said('flag', 'ff-on', 1, 'a.test.ts:4'),
      said('flag', 'ff-off', 1, 'a.test.ts:5'),
      said('flag', 'ff-on', 1, 'a.test.ts:7'),
    ]);
    expect(resolved).toEqual([
      { name: 'flag', value: 'ff-off', site: 'a.test.ts:5', level: 1 },
      { name: 'flag', value: 'ff-on', site: 'a.test.ts:4', level: 1 },
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
