import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { EVALUATING, PROBE_RUNTIME } from '../instrument/index.js';
import journals from './journal-format.cjs';

/**
 * The collectors as a worker loads them: built, because they `require` their
 * neighbours by the names the build gives them.
 */
const collectors = createRequire(import.meta.url)(
  '../../dist/test-selection/collectors.cjs',
) as typeof import('./collectors.cjs');

type Probe = (ordinal: number) => void;
type Scope = { enter<Result>(key: string, body: () => Result): Result };
type Presence = Map<string, Uint32Array>;

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const FILE = 'file.test.js';

/**
 * What a region's journal entry means, kept the plain way: one number per
 * region, nonzero once entered, carrying {@link EVALUATING} once entered while
 * any module was evaluating, and a module's own block marked in every bucket
 * that touched it. The engine keeps none of this; the journal it writes has to
 * be the one this writes.
 */
class Model {
  depth = 0;
  current: Presence = new Map();
  touch(id: string, count: number, ordinal: number): void {
    let row = this.current.get(id);
    if (row === undefined) {
      row = new Uint32Array(count);
      this.current.set(id, row);
    }
    row[0]! |= 1;
    row[ordinal]! |= this.depth > 0 ? EVALUATING | 1 : 1;
  }
}

/** A small deterministic generator, so a failure names its seed. */
function random(seed: number): (below: number) => number {
  let state = seed >>> 0 || 1;
  return (below) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % below;
  };
}

interface Loaded {
  readonly id: string;
  readonly count: number;
  readonly probe: Probe;
}

/**
 * One file's worth of recording, driven through the emitted runtime and the
 * model side by side: modules evaluated inside one another, a region entered
 * outside an evaluation and then inside one, modules first evaluated in the
 * middle of a case, and a module evaluated a second time under the same id.
 */
function drive(mode: 'flat' | 'sequential' | 'continuations', seed: number) {
  const next = random(seed);
  const holder: Record<PropertyKey, unknown> = {};
  const collector =
    mode === 'flat' ? collectors.flat(holder) : collectors.scoped(holder, mode === 'continuations');
  const model = new Model();
  const loaded: Loaded[] = [];

  const hit = (): void => {
    if (loaded.length === 0) return;
    const module = loaded[next(loaded.length)]!;
    const ordinal = 1 + next(module.count - 1);
    module.probe(ordinal);
    model.touch(module.id, module.count, ordinal);
  };
  const work = (hits: number, nesting: number): void => {
    for (let at = 0; at < hits; at += 1) {
      if (nesting < 3 && next(40) === 0) evaluate(nesting + 1);
      else hit();
    }
  };
  function evaluate(nesting: number): void {
    // A second instance under an id already loaded is what `resetModules`
    // makes: a new module text reading the same row.
    const again = loaded.length > 0 && next(6) === 0 ? loaded[next(loaded.length)]! : undefined;
    const id = again?.id ?? `m${loaded.length}`;
    const count = again?.count ?? 2 + next(60);
    const runtime = PROBE_RUNTIME.replace('.r(0,0)', `.r(${JSON.stringify(id)},${count})`);
    model.depth += 1;
    model.touch(id, count, 0);
    const text = `${runtime}__run(__va);__vaE();return __va;`;
    const probe = new Function('globalThis', '__run', text)(holder, (own: Probe) => {
      loaded.push({ id, count, probe: own });
      work(next(30), nesting);
    }) as Probe;
    model.depth -= 1;
    expect(typeof probe).toBe('function');
  }

  for (let module = 0; module < 12; module += 1) evaluate(1);
  const sealedModel: Presence = new Map([...model.current].map(([id, row]) => [id, row.slice()]));
  const sealed = collector.seal(FILE);
  const frames: Uint8Array[] = [];
  if (mode === 'flat') {
    work(4000, 0);
    const { modules } = collector.finish(FILE);
    return {
      engine: journals.encodeJournal(FILE, modules, sealed),
      model: journals.encodeJournal(FILE, model.current, sealedModel),
      frames: [undefined, undefined],
    };
  }

  const union: Presence = new Map();
  const fold = (name: string, presence: Presence): void => {
    if (presence.size === 0) return;
    frames.push(journals.encodeJournal(name, presence));
    for (const [id, row] of presence) {
      let into = union.get(id);
      if (into === undefined || into.length !== row.length) {
        into = new Uint32Array(row.length);
        union.set(id, into);
      }
      for (let at = 0; at < row.length; at += 1) {
        const value = row[at]!;
        if (value !== 0) into[at]! |= value & EVALUATING ? EVALUATING | 1 : 1;
      }
    }
  };
  fold(journals.packCase(FILE, '', ''), sealedModel);
  const ambient: Presence = new Map();
  model.current = ambient;
  const scope = holder[CASE_SCOPE] as Scope;
  for (let index = 0; index < 60; index += 1) {
    work(next(20), 0);
    const key = journals.packCase(FILE, `case ${index % 45}`, String(index % 45));
    const presence: Presence = new Map();
    scope.enter(key, () => {
      model.current = presence;
      work(next(300), 0);
    });
    model.current = ambient;
    // The case returned, so its frame is named as one that finished.
    fold(journals.settledCase(key, false), presence);
  }
  work(next(20), 0);
  fold(journals.packCase(FILE, '', ''), ambient);
  const done = collector.finish(FILE);
  return {
    engine: journals.encodeJournal(FILE, done.modules, sealed),
    model: journals.encodeJournal(FILE, union, sealedModel),
    frames: [journals.packFrames(done.frames ?? []), journals.packFrames(frames)],
  };
}

describe('the recording a file writes', () => {
  it.each(['flat', 'sequential', 'continuations'] as const)(
    'is byte for byte the journal of every region entered, and which were entered while evaluating: %s',
    (mode) => {
      for (const seed of [1, 7, 42, 1009, 65_537]) {
        const { engine, model, frames } = drive(mode, seed);
        expect(Buffer.from(engine).equals(Buffer.from(model)), `.va, seed ${seed}`).toBe(true);
        if (frames[0] !== undefined) {
          expect(Buffer.from(frames[0]).equals(Buffer.from(frames[1]!)), `.vac, seed ${seed}`).toBe(true);
        }
      }
    },
  );

  it('marks a region entered outside an evaluation again when a later evaluation enters it', () => {
    const holder: Record<PropertyKey, unknown> = {};
    const collector = collectors.flat(holder);
    const load = (id: string, run: (own: Probe) => void): Probe => {
      const runtime = PROBE_RUNTIME.replace('.r(0,0)', `.r("${id}",5)`);
      const text = `${runtime}__run(__va);__vaE();return __va;`;
      return new Function('globalThis', '__run', text)(holder, run) as Probe;
    };
    const outer = load('outer', () => {});
    outer(1);
    load('inner', () => {
      outer(1);
      outer(2);
    });
    outer(3);
    const { modules } = journals.decodeJournal(journals.encodeJournal(FILE, collector.finish(FILE).modules));

    // 1 was entered before `inner` evaluated and again while it did, so it is
    // shared; 3 only after. 0 is the module's own evaluation.
    expect(modules.find((module) => module.id === 'outer')).toMatchObject({
      hits: [0, 1, 2, 3],
      shared: [0, 1, 2],
    });
  });
});

describe('how a case settles', () => {
  it('names each frame by whether its body returned, threw, rejected or never settled', async () => {
    const holder: Record<PropertyKey, unknown> = {};
    const collector = collectors.scoped(holder, true);
    const scope = holder[CASE_SCOPE] as Scope;
    const key = (name: string) => journals.packCase(FILE, name, name);
    scope.enter(key('returned'), () => {});
    expect(() => scope.enter(key('threw'), () => { throw new Error('no'); })).toThrow('no');
    await expect(scope.enter(key('rejected'), () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    // A timeout: the runner moved on and the body is still pending at `finish`.
    void scope.enter(key('abandoned'), () => new Promise(() => {}));

    const frames = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
    const settled = frames.map((frame) => journals.unpackCase(journals.decodeJournal(frame).testFile))
      .filter((unpacked) => unpacked.name !== '')
      .map((unpacked) => [unpacked.name, unpacked.stopped]);

    // No case crossed anything, so only the ones that stopped wrote a frame:
    // a frame is how a reader learns the journey was cut short.
    expect(settled).toEqual([['threw', true], ['rejected', true], ['abandoned', true]]);
  });
});

