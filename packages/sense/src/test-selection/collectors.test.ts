import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { EVALUATING, probeRuntime } from '../instrument/index.js';
import preconditions from './case-preconditions.cjs';
import journals from './journal-format.cjs';

/**
 * The collectors as a worker loads them: built, because they `require` their
 * neighbours by the names the build gives them.
 */
const collectors = createRequire(import.meta.url)(
  '../../dist/test-selection/collectors.cjs',
) as typeof import('./collectors.cjs');
const stories = createRequire(import.meta.url)(
  '../../dist/story/format.cjs',
) as typeof import('../story/format.cjs');

type Probe = (ordinal: number) => void;
type Scope = { enter<Result>(key: string, body: () => Result): Result };
type Presence = Map<string, Uint32Array>;

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const FILE = 'file.test.js';

/**
 * What a region's journal entry means, kept the plain way: one number per
 * region, 1 once entered while no module was evaluating and 2 once entered
 * while one was, and a module's own block marked the same way in every bucket
 * that touched it. The engine keeps none of this; the journal it writes has to
 * be the one this writes.
 */
class Model {
  depth = 0;
  current: Presence = new Map();
  /** Every visit in order, `module:ordinal` with `:E` while evaluating: what a story is. */
  told: string[] = [];
  touch(id: string, count: number, ordinal: number): void {
    this.told.push(`${id}:${ordinal}${this.depth > 0 ? ':E' : ''}`);
    let row = this.current.get(id);
    if (row === undefined) {
      row = new Uint32Array(count);
      this.current.set(id, row);
    }
    const way = this.depth > 0 ? 2 : 1;
    row[0]! |= way;
    row[ordinal]! |= way;
  }
}

/** The ways a region was entered as the file's journal reads them: entered, and whether ever while evaluating. */
function counters(presence: Presence): Presence {
  return new Map([...presence].map(([id, row]) => [id, row.map((ways) => (ways === 0 ? 0 : ways & 2 ? EVALUATING | 1 : 1))]));
}

/** A case's frame from the ways each region was entered, as the probe log reads out. */
function frame(name: string, presence: Presence): Buffer {
  const ids = [...presence.keys()];
  const sorted: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  for (const row of presence.values()) {
    start.push(sorted.length);
    row.forEach((ways, ordinal) => {
      if (ways & 1) sorted.push(ordinal << 1);
      if (ways & 2) sorted.push((ordinal << 1) | 1);
    });
    end.push(sorted.length);
  }
  const rows = ids.map((_, row) => row);
  return journals.encodeLog(name, { rows, start: Int32Array.from(start), end: Int32Array.from(end), sorted: Int32Array.from(sorted), ids });
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
function drive(mode: 'flat' | 'sequential' | 'continuations', seed: number, story = false) {
  const next = random(seed);
  const holder: Record<PropertyKey, unknown> = {};
  const written = new Map<string, Uint8Array>();
  const collector = mode === 'flat'
    ? collectors.flat(holder)
    : collectors.scoped(holder, mode === 'continuations', story ? (key, bytes) => written.set(key, bytes) : undefined);
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
    const runtime = probeRuntime(id, count);
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
      model: journals.encodeJournal(FILE, counters(model.current), counters(sealedModel)),
      frames: [undefined, undefined],
      stories: undefined,
    };
  }

  const union: Presence = new Map();
  // Every case writes a frame; the file's own bucket only when it entered something.
  const fold = (name: string, presence: Presence, always = false): void => {
    if (presence.size === 0 && !always) return;
    frames.push(frame(name, presence));
    for (const [id, row] of presence) {
      let into = union.get(id);
      if (into === undefined || into.length !== row.length) {
        into = new Uint32Array(row.length);
        union.set(id, into);
      }
      for (let at = 0; at < row.length; at += 1) {
        into[at]! |= row[at]!;
      }
    }
  };
  fold(journals.packCase(FILE, '', ''), sealedModel);
  const ambient: Presence = new Map();
  model.current = ambient;
  const scope = holder[CASE_SCOPE] as Scope;
  // What each case's story should say, as `before` and the case, the last run
  // of a case replacing the first as the written story does.
  const told = new Map<string, readonly [string[], string[]]>();
  model.told = [];
  for (let index = 0; index < 60; index += 1) {
    work(next(20), 0);
    const key = journals.packCase(FILE, `case ${index % 45}`, String(index % 45));
    const presence: Presence = new Map();
    const before = model.told;
    model.told = [];
    scope.enter(key, () => {
      model.current = presence;
      work(next(300), 0);
    });
    // A case that visited nothing is told as nothing, before included.
    told.set(key, model.told.length > 0 ? [before, model.told] : [[], []]);
    model.told = [];
    model.current = ambient;
    // The case returned, so its frame is named as one that finished, and as
    // one a recorder listened to that said nothing.
    fold(preconditions.packSaid(journals.settledCase(key, false), []), presence, true);
  }
  work(next(20), 0);
  fold(journals.packCase(FILE, '', ''), ambient);
  const done = collector.finish(FILE);
  return {
    engine: journals.encodeJournal(FILE, done.modules, sealed),
    model: journals.encodeJournal(FILE, counters(union), counters(sealedModel)),
    frames: [journals.packFrames(done.frames ?? []), journals.packFrames(frames)],
    stories: [new Map([...written].map(([key, bytes]) => [key, spoken(bytes)])), told] as const,
  };
}

/** A story's visits in the model's spelling. */
function spoken(bytes: Uint8Array): readonly [string[], string[]] {
  const story = stories.decodeStory(bytes);
  const bases: number[] = [];
  let total = 0;
  for (const [, count] of story.rows) {
    bases.push(total);
    total += count;
  }
  const say = (visits: Int32Array): string[] =>
    [...visits].map((entry) => {
      const index = entry & ~EVALUATING;
      let row = bases.length - 1;
      while (bases[row]! > index) row -= 1;
      return `${story.rows[row]![0]}:${index - bases[row]!}${entry & EVALUATING ? ':E' : ''}`;
    });
  return [say(story.before), say(story.visits)];
}

describe('the recording a file writes', () => {
  it.each(['flat', 'sequential', 'continuations'] as const)(
    'is byte for byte the journal of every region entered, and which were entered while evaluating: %s',
    (mode) => {
      let twice = 0;
      for (const seed of [1, 7, 42, 1009, 65_537]) {
        const { engine, model, frames } = drive(mode, seed);
        expect(Buffer.from(engine).equals(Buffer.from(model)), `.va, seed ${seed}`).toBe(true);
        if (frames[0] !== undefined) {
          expect(Buffer.from(frames[0]).equals(Buffer.from(frames[1]!)), `.vac, seed ${seed}`).toBe(true);
          for (const written of journals.unpackFrames(frames[0])) {
            const ids = journals.decodeJournal(written).modules.map((module) => module.id);
            if (new Set(ids).size < ids.length) twice += 1;
          }
        }
      }
      // A case entered some module both while one evaluated and after, so the
      // frames carry the second row that says so.
      if (mode !== 'flat') expect(twice).toBeGreaterThan(0);
    },
  );

  it.each(['sequential', 'continuations'] as const)(
    'is the same journal with stories taped, and each story is every visit its case made, in order: %s',
    (mode) => {
      for (const seed of [1, 7, 42, 1009, 65_537]) {
        const plain = drive(mode, seed);
        const { engine, frames, stories: [written, told] = [] } = drive(mode, seed, true);
        expect(Buffer.from(engine).equals(Buffer.from(plain.engine)), `.va, seed ${seed}`).toBe(true);
        expect(Buffer.from(frames[0]!).equals(Buffer.from(plain.frames[0]!)), `.vac, seed ${seed}`).toBe(true);
        expect(told!.size, `seed ${seed}`).toBeGreaterThan(30);
        expect(written, `stories, seed ${seed}`).toEqual(told);
      }
    },
  );

  it('marks a region entered outside an evaluation again when a later evaluation enters it', () => {
    const holder: Record<PropertyKey, unknown> = {};
    const collector = collectors.flat(holder);
    const load = (id: string, run: (own: Probe) => void): Probe => {
      const runtime = probeRuntime(id, 5);
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

    // No case crossed anything, and each still wrote a frame: the case index
    // names every case that ran, and a frame is how a reader learns the
    // journey was cut short.
    expect(settled).toEqual([['returned', false], ['threw', true], ['rejected', true], ['abandoned', true]]);
  });

  it('names a case that handed out a journey by both its settling and its journey', () => {
    const holder: Record<PropertyKey, unknown> = {};
    const collector = collectors.scoped(holder, true);
    const scope = holder[CASE_SCOPE] as Scope & { journey(): string | undefined };
    let journey: string | undefined;
    // Nothing crossed in-process: the journey alone is what makes the frame.
    scope.enter(journals.packCase(FILE, 'called', 'called'), () => {
      journey = scope.journey();
    });

    const [frame] = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
    const owner = journals.decodeJournal(frame!).testFile;
    expect(journals.unpackCase(owner)).toMatchObject({ name: 'called', stopped: false });
    expect(journals.journeyOf(owner)).toBe(journey);
    // A part frame has no case and no settling, and names the journey in the same field.
    expect(journals.journeyOf(journals.packJourney(journals.packCase('', '', ''), journey!))).toBe(journey);
  });

  it('runs every case inside the trace its realm was handed, whose id is the journey its frame names', () => {
    const carried: { journey: string; name: string }[] = [];
    let running: string | undefined;
    const holder: Record<PropertyKey, unknown> = {
      [Symbol.for('variance-authority.test-selection.trace')]: {
        name: 'tracer',
        carry: (journey: string, name: string, body: () => unknown) => {
          carried.push({ journey, name });
          running = journey;
          try {
            return body();
          } finally {
            running = undefined;
          }
        },
        current: () => running,
      },
    };
    const collector = collectors.scoped(holder, true);
    const scope = holder[CASE_SCOPE] as Scope & { journey(): string | undefined };
    let inside: string | undefined;
    // The case never asks for its journey: the trace is what carries it.
    expect(scope.enter(journals.packCase(FILE, 'quotes', 'quotes'), () => {
      inside = running;
      return 'answered';
    })).toBe('answered');

    expect(carried).toHaveLength(1);
    expect(carried[0]!.name).toBe('quotes');
    expect(carried[0]!.journey).toMatch(/^[0-9a-f]{32}$/);
    expect(inside).toBe(carried[0]!.journey);
    const [frame] = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
    expect(journals.journeyOf(journals.decodeJournal(frame!).testFile)).toBe(carried[0]!.journey);
  });
});

describe('what a case said it arranged', () => {
  const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');
  const said = (frame: Uint8Array) => {
    const owner = journals.decodeJournal(frame).testFile;
    return [journals.unpackCase(owner).name, preconditions.saidOf(owner)?.map(([name, value, , level]) => [name, value, level])];
  };

  it('travels in the frame of the case that said it, and a case that only said something still writes one', () => {
    const holder: Record<PropertyKey, unknown> = {};
    const collector = collectors.scoped(holder, false);
    const scope = holder[CASE_SCOPE] as Scope & {
      phase(where: { kind: 'each'; depth: number } | undefined): void;
    };
    const say = holder[PRECONDITION] as (named: unknown, value: unknown, called: Error) => void;
    scope.phase({ kind: 'each', depth: 1 });
    say({ network: 'mocked' }, undefined, new Error());
    scope.phase(undefined);
    scope.enter(journals.packCase(FILE, 'checkout > pays', '0'), () => say({ flag: 'ff-on' }, undefined, new Error()));
    expect(() => scope.enter(journals.packCase(FILE, 'refunds > pays', '1'), () => {
      throw new Error('stopped, so it writes a frame, and said nothing');
    })).toThrow('stopped');

    const frames = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
    expect(frames.map(said).filter(([name]) => name !== '')).toEqual([
      ['checkout > pays', [['network', 'mocked', 1], ['flag', 'ff-on', preconditions.CASE_LEVEL]]],
      // Listened to and silent: an empty list, not an unmeasured case.
      ['refunds > pays', []],
    ]);
  });

  it('throws for a call its case makes after it settled, from work it left behind', async () => {
    const holder: Record<PropertyKey, unknown> = {};
    collectors.scoped(holder, true);
    const scope = holder[CASE_SCOPE] as Scope;
    const say = holder[PRECONDITION] as (named: unknown, value: unknown, called: Error) => void;
    let late: Promise<void> | undefined;
    await scope.enter(journals.packCase(FILE, 'pays', '0'), async () => {
      late = new Promise((settle) => setTimeout(settle, 5)).then(() => say({ network: 'mocked' }, undefined, new Error()));
    });
    await expect(late).rejects.toThrow(/ran outside a running case/);
  });
});
