import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseSync } from 'oxc-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import caseOwner from './case-owner.cjs';
import preconditions from './case-preconditions.cjs';
import { preconditionText, readsOf, rowOf, saidJoined, saidRow, saidSite } from './case-said.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
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
    expect(() => variancePrecondition('fixture', { network: 'mocked' })).not.toThrow();
    const started = performance.now();
    for (let at = 0; at < 100_000; at += 1) variancePrecondition('fixture', { network: 'mocked' });
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
    expect(() => variancePrecondition('fixture', { network: 'mocked' })).not.toThrow();
  });
});

describe('the recorder a case scope installs', () => {
  const keyOf = (name: string): string => `/repo/a.test.ts\u0000${name}\u00001`;

  it('puts a call in a case body on that case, at the case level, with the line that said it', () => {
    let running: string | undefined = keyOf('pays');
    const recorder = preconditions.recorder(globalThis, () => running);
    variancePrecondition('fixture', { network: 'mocked' }); const line = new Error().stack!.split('\n')[1]!;
    variancePrecondition('fixture', { flag: 'ff-on', seeded: true });
    running = undefined;
    const { said } = recorder.take(keyOf('pays'));
    expect(said.map(([name, value, , level]) => [name, value, level])).toEqual([
      ['fixture:network', '"mocked"', preconditions.CASE_LEVEL],
      ['fixture:flag', '"ff-on"', preconditions.CASE_LEVEL],
      ['fixture:seeded', 'true', preconditions.CASE_LEVEL],
    ]);
    const site = said[0]![2];
    expect(line).toContain(site);
    expect(site).toMatch(/precondition\.test\.ts:\d+$/);
  });

  it('throws for a call where no case is running, through the entry, with the line that made it', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    expect(() => variancePrecondition('fixture', { flag: 'ff-off' })).toThrow(
      /variancePrecondition at \S*precondition\.test\.ts:\d+ ran outside a running case/,
    );
    recorder.phase({ kind: 'outside', because: 'ran in a beforeAll, which runs for no one case' });
    expect(() => variancePrecondition('fixture', { flag: 'ff-off' })).toThrow(/ran in a beforeAll/);
    recorder.phase(undefined);
    expect(recorder.take(keyOf('pays'))).toEqual({ said: [], read: [], misused: [] });
  });

  it('forgets what a beforeEach said for a case that never entered when the next case begins', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    recorder.begin();
    recorder.within({ kind: 'each', depth: 1 }, () => variancePrecondition('fixture', { doomed: true }));
    recorder.begin();
    recorder.within({ kind: 'each', depth: 0 }, () => variancePrecondition('fixture', { network: 'live' }));
    recorder.entered(keyOf('after doomed > pays'));
    expect(recorder.take(keyOf('after doomed > pays')).said.map(([name]) => name)).toEqual(['fixture:network']);
  });

  it('keeps the beforeEach of one context apart from another', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    const left = {};
    const right = {};
    recorder.within({ kind: 'each', depth: 1, token: left }, () => variancePrecondition('fixture', { lane: 'left' }));
    recorder.within({ kind: 'each', depth: 1, token: right }, () => variancePrecondition('fixture', { lane: 'right' }));
    recorder.entered(keyOf('right'), right);
    recorder.entered(keyOf('left'), left);
    expect(recorder.take(keyOf('left')).said.map(([, value]) => value)).toEqual(['"left"']);
    expect(recorder.take(keyOf('right')).said.map(([, value]) => value)).toEqual(['"right"']);
  });

  it('gives a beforeEach that names no case to the next case that opens', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    recorder.within({ kind: 'each', depth: 1 }, () => variancePrecondition('fixture', { network: 'mocked' }));
    recorder.entered(keyOf('checkout > pays'));
    recorder.entered(keyOf('checkout > refunds'));
    expect(recorder.take(keyOf('checkout > pays')).said.map(([name, , , level]) => [name, level])).toEqual([['fixture:network', 1]]);
    expect(recorder.take(keyOf('checkout > refunds'))).toEqual({ said: [], read: [], misused: [] });
  });

  it('records no case for a call after the case, and says where it was', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
    try {
      recorder.within({ kind: 'after' }, () => variancePrecondition('fixture', { network: 'mocked' }));
    } finally {
      console.warn = warn;
    }
    expect(recorder.take(keyOf('pays'))).toEqual({ said: [], read: [], misused: [] });
    expect(String(warned[0])).toMatch(/precondition\.test\.ts:\d+ ran after its case/);
  });

  it('names the call site from the checkout in what it warns and throws, as the row names it', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const site = /variancePrecondition at packages\/sense\/src\/test-selection\/precondition\.test\.ts:\d+ /;
    const recorder = preconditions.recorder(globalThis, () => undefined, undefined, (called) => saidSite(root, called));
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
    try {
      recorder.within({ kind: 'after' }, () => variancePrecondition('fixture', { network: 'mocked' }));
      variancePrecondition('fixture' as string, { '': 'ff-on' });
    } finally {
      console.warn = warn;
    }
    expect(String(warned[0])).toMatch(site);
    expect(String(warned[1])).toMatch(site);
    expect(() => variancePrecondition('fixture', { flag: 'ff-off' })).toThrow(site);
  });

  it('keeps a value as its JSON text, and one JSON cannot hold as unrecorded', () => {
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'));
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    variancePrecondition('flags', { 'new-checkout': true, tier: 'gold', limits: { cart: 3 }, when: new Date(0) });
    variancePrecondition('flags', { render: () => 1, cycle, huge: 10n, nan: Number.NaN, deep: { gone: undefined } });
    expect(recorder.take(keyOf('pays')).said.map(([name, value]) => [name, value])).toEqual([
      ['flags:new-checkout', 'true'],
      ['flags:tier', '"gold"'],
      ['flags:limits', '{"cart":3}'],
      ['flags:when', '"1970-01-01T00:00:00.000Z"'],
      ['flags:render', null],
      ['flags:cycle', null],
      ['flags:huge', null],
      ['flags:nan', null],
      ['flags:deep', null],
    ]);
  });

  it('throws for a dimension holding `:`, which no name could be split back from', () => {
    preconditions.recorder(globalThis, () => keyOf('pays'));
    expect(() => variancePrecondition('flags:new', { checkout: true })).toThrow(/names the dimension "flags:new", which holds `:`/);
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
      variancePrecondition('fixture', { network: 'mocked' });
    });
    expect(() => variancePrecondition('fixture', { flag: true })).toThrow(outside);
    expect(recorder.take(keyOf('pays')).said.map(([name, value, , level]) => [name, value, level])).toEqual([['fixture:network', '"mocked"', 1]]);
  });

  it('stands back where it was once a hook returns, throws, resolves or rejects', async () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    expect(() => recorder.within(each('pays'), () => {
      throw new Error('the hook failed');
    })).toThrow('the hook failed');
    expect(() => variancePrecondition('fixture', { flag: true })).toThrow(outside);

    await recorder.within(each('pays'), async () => {
      await Promise.resolve();
      variancePrecondition('fixture', { flag: 'ff-on' });
    });
    expect(() => variancePrecondition('fixture', { flag: true })).toThrow(outside);

    await expect(recorder.within(each('pays'), async () => {
      await Promise.resolve();
      throw new Error('the async hook failed');
    })).rejects.toThrow('the async hook failed');
    expect(() => variancePrecondition('fixture', { flag: true })).toThrow(outside);
    expect(recorder.take(keyOf('pays')).said.map(([, value]) => value)).toEqual(['"ff-on"']);
  });

  it('forgets every case and every pending beforeEach when its file finishes', () => {
    const recorder = preconditions.recorder(globalThis, () => undefined);
    recorder.within(each('pays'), () => variancePrecondition('fixture', { network: 'mocked' }));
    recorder.within({ kind: 'each', depth: 0 }, () => variancePrecondition('fixture', { seeded: true }));
    recorder.finish();
    recorder.entered(keyOf('refunds'));
    expect(recorder.take(keyOf('pays'))).toEqual({ said: [], read: [], misused: [] });
    expect(recorder.take(keyOf('refunds'))).toEqual({ said: [], read: [], misused: [] });
  });

  it('records nothing for a record alone, a dimension and a string, or a record holding an empty key', () => {
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'));
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
    const loose = variancePrecondition as (named: unknown, value?: unknown) => void;
    try {
      loose({ network: 'mocked' });
      loose('network', 'mocked');
      loose('', { upsell: 'mocked' });
      variancePrecondition('network', { '': 'mocked' });
    } finally {
      console.warn = warn;
    }
    expect(warned).toHaveLength(4);
    expect(warned[1]).toContain('takes a dimension and a record of keys to values; nothing was recorded');
    expect(recorder.take(keyOf('pays'))).toEqual({ said: [], read: [], misused: [] });
  });

  it('names a call it cannot place on a stack as no site, and a dev server\'s `/@fs/` URL as the file it serves', () => {
    const recorder = preconditions.recorder(globalThis, () => keyOf('pays'));
    const say = realm[PRECONDITION] as (named: unknown, value: unknown, called: unknown) => void;
    say('at', { none: true }, undefined);
    say('at', { short: true }, { stack: 'Error\n    at entry (/repo/precondition.js:1:1)' });
    say('at', { served: true }, {
      stack: 'Error\n    at entry (http://localhost:5173/@fs/repo/precondition.js:1:1)\n' +
        '    at http://localhost:5173/@fs/repo/test/a.test.ts?v=1:4:7',
    });
    say('at', { named: true }, {
      stack: 'entry@http://localhost:5173/@fs/repo/precondition.js:1:1\n' +
        'pays@http://localhost:5173/@fs/repo/test/a.test.ts:9:3',
    });
    say('at', { rooted: true }, {
      stack: 'Error\n    at entry (http://localhost:5173/precondition.js:1:1)\n' +
        '    at http://localhost:5173/test/a.test.ts:2:5',
    });
    const { said } = recorder.take(keyOf('pays'));
    expect(said.map(([name, , site]) => [name, site])).toEqual([
      ['at:none', ''],
      ['at:short', ''],
      ['at:served', 'http://localhost:5173/@fs/repo/test/a.test.ts?v=1:4'],
      ['at:named', 'http://localhost:5173/@fs/repo/test/a.test.ts:9'],
      ['at:rooted', 'http://localhost:5173/test/a.test.ts:2'],
    ]);
    // A site served from the dev server's root keeps its URL.
    expect(said.map(([, , site]) => saidSite('/repo', site))).toEqual([
      '', '', 'test/a.test.ts:4', 'test/a.test.ts:9', 'http://localhost:5173/test/a.test.ts:2',
    ]);
  });

  it('refuses a frame owner whose sixth field is not what a case heard', () => {
    const field = caseOwner.heardField('a.test.ts\u0000pays\u00001\u0000\u0000\u0000[]');
    expect(field).toBe('[]');
    expect(() => saidJoined(undefined, [field])).toThrow(/not what a case heard/);
  });
});

describe('resolving what a case said', () => {
  const said = (name: string, value: unknown, level: number, site = 'a.test.ts:1') =>
    [name, JSON.stringify(value), site, level] as const;
  const spelled = (...items: readonly (readonly unknown[])[]) => JSON.stringify({ said: items });

  it('lets a narrower level override a wider one', () => {
    expect(saidRow(spelled(
      said('flags:checkout', 'ff-off', 0, 'a.test.ts:1'),
      said('flags:checkout', 'ff-on', preconditions.CASE_LEVEL, 'a.test.ts:9'),
    )).said).toEqual([{ name: 'flags:checkout', value: 'ff-on', site: 'a.test.ts:9', level: preconditions.CASE_LEVEL }]);
  });

  it('keeps two values said at one level, and reports them as a contradiction', () => {
    const resolved = saidRow(spelled(
      said('flags:checkout', 'ff-on', 1, 'a.test.ts:4'),
      said('flags:checkout', 'ff-off', 1, 'a.test.ts:5'),
      said('flags:checkout', 'ff-on', 1, 'a.test.ts:7'),
    )).said!;
    expect(resolved).toEqual([
      { name: 'flags:checkout', value: 'ff-off', site: 'a.test.ts:5', level: 1 },
      { name: 'flags:checkout', value: 'ff-on', site: 'a.test.ts:4', level: 1 },
    ]);
    expect(preconditionText(resolved)).toBe('flags:checkout contradicted: ff-off (a.test.ts:5), ff-on (a.test.ts:4)');
  });

  it('prints a value that is not a string as JSON, and one JSON could not hold as unrecorded', () => {
    const resolved = saidRow(JSON.stringify({ said: [
      said('flags:limits', { cart: 3 }, 0),
      ['flags:render', null, 'a.test.ts:2', 0],
      said('flags:seeded', true, 0),
    ] })).said!;
    expect(preconditionText(resolved)).toBe('flags:limits={"cart":3} (a.test.ts:1), flags:render=unrecorded (a.test.ts:2), flags:seeded (a.test.ts:1)');
  });

  it('names a value said at several sites at the first of them in site order, however the calls were made', () => {
    // What a case said is stored in one order, whichever frame or call said it first.
    const joined = saidJoined(undefined, [
      spelled(said('flags:checkout', 'ff-on', 1, 'b.test.ts:9')),
      spelled(said('flags:checkout', 'ff-on', 1, 'a.test.ts:2')),
    ]);
    expect(joined).toBe(spelled(said('flags:checkout', 'ff-on', 1, 'a.test.ts:2'), said('flags:checkout', 'ff-on', 1, 'b.test.ts:9')));
    expect(saidRow(joined!).said).toEqual([{ name: 'flags:checkout', value: 'ff-on', site: 'a.test.ts:2', level: 1 }]);
  });

  it('carries what a frame heard in its owner, and tells a silent frame from one that never listened', () => {
    const owner = 'a.test.ts\u0000pays\u00001';
    const packed = caseOwner.packHeard(owner, { said: [said('network:upsell', 'mocked', 0)] });
    expect(caseOwner.heardField(packed)).toBe(spelled(said('network:upsell', 'mocked', 0)));
    expect(caseOwner.heardField(caseOwner.packHeard(owner, { said: [] }))).toBe('{"said":[]}');
    expect(caseOwner.heardField(caseOwner.packHeard(owner, { said: [], read: [] }))).toBe('{"said":[],"read":[]}');
    expect(caseOwner.heardField(caseOwner.packHeard(owner, { said: [], read: [], misused: [] })))
      .toBe('{"said":[],"read":[],"misused":[]}');
    expect(caseOwner.heardField(owner)).toBeUndefined();
    expect(packed.split('\u0000').slice(0, 3)).toEqual(['a.test.ts', 'pays', '1']);
  });

  it('keeps what a beforeEach said under what the case body overrode it with, and resolves it only when read', () => {
    const arranged = spelled(said('flags:checkout', 'off', 0, 'a.test.ts:3'), said('flags:checkout', 'on', preconditions.CASE_LEVEL, 'a.test.ts:9'));
    const back = decodeExecutionIndex(encodeAsSetExecutionIndex({
      tests: [{ id: 'a.test.ts > pays', file: 'a.test.ts', name: 'pays', said: arranged }],
      modules: [],
    })).tests[0]!;

    expect(back.said).toBe(arranged);
    expect(preconditionText(rowOf(back)!)).toBe('flags:checkout=on (a.test.ts:9)');
    expect(readsOf(back)).toBeUndefined();
  });

  it('stores what the code read beside what the case said, and reads an empty facet as nothing read', () => {
    const heard = JSON.stringify({
      said: [said('flags:checkout', 'on', 0, 'a.test.ts:3')],
      read: [said('flags:checkout', 'off', preconditions.CASE_LEVEL, 'src/flags.ts:4')],
    });
    const [back, silent] = decodeExecutionIndex(encodeAsSetExecutionIndex({
      tests: [
        { id: 'a.test.ts > pays', file: 'a.test.ts', name: 'pays', said: heard },
        { id: 'a.test.ts > waits', file: 'a.test.ts', name: 'waits', said: '{"said":[],"read":[]}' },
      ],
      modules: [],
    })).tests;
    expect(back!.said).toBe(heard);
    expect(readsOf(back!)).toEqual([{ name: 'flags:checkout', value: 'off', site: 'src/flags.ts:4', level: preconditions.CASE_LEVEL }]);
    expect(readsOf(silent!)).toEqual([]);
  });

  it('stores each misused breadcrumb in a section of its own, which no read of the case holds', () => {
    const heard = JSON.stringify({
      said: [],
      read: [said('flags:checkout', 'off', preconditions.CASE_LEVEL, 'src/flags.ts:4')],
      misused: [['key', '7', 'src/pay.ts:9', preconditions.CASE_LEVEL]],
    });
    const back = decodeExecutionIndex(encodeAsSetExecutionIndex({
      tests: [{ id: 'a.test.ts > pays', file: 'a.test.ts', name: 'pays', said: heard }],
      modules: [],
    })).tests[0]!;
    expect(back.said).toBe(heard);
    expect(readsOf(back)).toEqual([{ name: 'flags:checkout', value: 'off', site: 'src/flags.ts:4', level: preconditions.CASE_LEVEL }]);
    expect(saidRow(back.said!).misused).toEqual([{ argument: 'key', value: 7, site: 'src/pay.ts:9', level: preconditions.CASE_LEVEL }]);
  });
});
