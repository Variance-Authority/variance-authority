import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EVALUATING, instrument } from './index.js';
import probeLog from './probe-log.cjs';

/**
 * The tap as a seam loads it: built, because it `require`s the engine by the
 * name the build gives it.
 */
const storyTap = createRequire(import.meta.url)(
  '../../dist/instrument/story-tap.cjs',
) as typeof import('./story-tap.cjs');

type Engine = ReturnType<typeof probeLog.createEngine>;

const PRICE = `
function price(n) { let total = 0; for (let i = 0; i < n; i++) { if (i % 2) total += 1; else total += 2 } return total }
function cart(n) { out.push(price(n)) }
`;

/** A module evaluated once against `root`, with `run` left behind to call it again. */
function load(root: object, source = PRICE): { run(n: number): void; blocks: ReturnType<typeof instrument> } {
  const instrumented = instrument(source, 'fixture.js');
  expect(instrumented).toBeDefined();
  const context = createContext({ out: [], __VA__: root });
  runInContext(instrumented!.code, context, { filename: 'fixture.js' });
  return { run: (n) => runInContext(`cart(${n})`, context), blocks: instrumented };
}

/** A tape as `E ` for evaluating and the block's path, one visit per line. */
function readable(tape: ReturnType<ReturnType<typeof storyTap.createTap>['read']>, source = PRICE): string[] {
  const blocks = instrument(source, 'fixture.js')!.blocks;
  const out: string[] = [];
  for (let at = 0; at < tape.taped; at += 1) {
    const entry = tape.tape[at]!;
    const block = blocks[(entry & ~EVALUATING) - tape.rows.bases[0]!]!;
    out.push([entry & EVALUATING ? 'E' : '', block.name, block.path].filter(Boolean).join(' '));
  }
  return out;
}

/** What each bucket's read-out holds, with the evaluating bit beside each ordinal. */
function presence(engine: Engine, bucket: ReturnType<Engine['open']>): unknown {
  return engine.lists(engine.read(bucket), true);
}

describe('a story tap', () => {
  it('tapes every visit in the order it happened, repeats included', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const { run } = load(tap.root);
    tap.reset();

    run(3);

    expect(readable(tap.read())).toEqual([
      'cart entry',
      'price entry',
      'price for#0/body',
      'price for#0/body/if#0/else',
      'price for#0/body',
      'price for#0/body/if#0/then',
      'price for#0/body',
      'price for#0/body/if#0/else',
      'price for#0/after',
    ]);
  });

  it('marks what ran while the module evaluated', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);

    load(tap.root, `${PRICE}\ncart(1);`);

    expect(readable(tap.read(), `${PRICE}\ncart(1);`)).toEqual([
      'E module',
      'E cart entry',
      'E price entry',
      'E price for#0/body',
      'E price for#0/body/if#0/else',
      'E price for#0/after',
    ]);
  });

  it('tapes no visit to the root of a module called into while another evaluates', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('loading'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const context = createContext({ out: [], __VA__: tap.root });
    runInContext(instrument(PRICE, 'fixture.js')!.code, context, { filename: 'fixture.js' });
    engine.use(engine.open('case'));
    tap.reset();

    // A second module whose top level calls the first, in a bucket that has
    // not held the first yet: the probe logs the first module's root there,
    // and nothing visited it. A function scope of its own, as a CommonJS
    // module has, so its header is not the first module's.
    const caller = instrument(`cart(1);`, 'caller.js')!.code;
    runInContext(`(function () {\n${caller}\n})()`, context, { filename: 'caller.js' });

    const first = tap.read().rows.bases[0]!;
    const count = instrument(PRICE, 'fixture.js')!.blocks.length;
    const visited = [...tap.read().tape.subarray(0, tap.read().taped)]
      .map((entry) => (entry & ~EVALUATING) - first)
      .filter((ordinal) => ordinal >= 0 && ordinal < count);
    expect(visited).not.toContain(0);
    expect(visited).toHaveLength(5);
  });

  it('leaves the presence record as it is without the tap', () => {
    const plain = probeLog.createEngine(false);
    const plainCases = [plain.open('a'), plain.open('b')];
    const tapped = probeLog.createEngine(false);
    const tappedCases = [tapped.open('a'), tapped.open('b')];
    const tap = storyTap.createTap(tapped, storyTap.TAPE_LIMIT);

    plain.use(plainCases[0]!);
    tapped.use(tappedCases[0]!);
    const without = load(plain.root, `${PRICE}\ncart(1);`);
    const withTap = load(tap.root, `${PRICE}\ncart(1);`);
    // Enough visits for the engine to compact the log under the tap.
    without.run(3000);
    withTap.run(3000);
    plain.use(plainCases[1]!);
    tapped.use(tappedCases[1]!);
    without.run(2);
    withTap.run(2);

    expect(tap.read().visits).toBeGreaterThan(6000);
    for (const at of [0, 1]) expect(presence(tapped, tappedCases[at]!)).toEqual(presence(plain, plainCases[at]!));
  });

  it('says where each case began', () => {
    const engine = probeLog.createEngine(false);
    const ambient = engine.open('');
    engine.use(ambient);
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const { run } = load(tap.root);
    tap.reset();

    run(1); // five visits
    engine.use(engine.open('first'));
    run(0); // three
    engine.use(ambient);
    run(0);
    engine.use(engine.open('second'));
    run(1);

    const tape = tap.read();
    expect(tape.keys).toEqual(['', 'first', '', 'second']);
    expect(tape.at).toEqual([0, 5, 8, 11]);
  });

  it('says which case each visit belonged to when the async context decides', async () => {
    const engine = probeLog.createEngine(true);
    const ambient = engine.open('');
    const scopes = new AsyncLocalStorage<ReturnType<Engine['open']>>();
    engine.scope(() => scopes.getStore() ?? ambient);
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const { run } = load(tap.root);
    tap.reset();

    const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
    await Promise.all([
      scopes.run(engine.open('first'), async () => { run(0); await tick(); run(0); }),
      scopes.run(engine.open('second'), async () => { run(0); await tick(); }),
    ]);

    // Interleaved as it ran: first resumed after second had started.
    expect(tap.read().keys).toEqual(['first', 'second', 'first']);
  });

  it('stops taping at its limit, counts what it missed, and records presence to the end', () => {
    const plain = probeLog.createEngine(false);
    const plainCase = plain.open('case');
    plain.use(plainCase);
    const engine = probeLog.createEngine(false);
    const bucket = engine.open('case');
    engine.use(bucket);
    const tap = storyTap.createTap(engine, 4);
    const withTap = load(tap.root);
    const without = load(plain.root);
    tap.reset();

    withTap.run(3);
    without.run(3);

    const tape = tap.read();
    expect([tape.taped, tape.visits]).toEqual([4, 9]);
    expect(presence(engine, bucket)).toEqual(presence(plain, plainCase));
  });

  it('is found by whoever looks for the engine behind a realm', () => {
    const engine = probeLog.createEngine(false);
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);

    expect(probeLog.engineOf(tap.root)).toBe(engine);
    expect(storyTap.tapOf(tap.root)).toBe(tap);
    expect(storyTap.tapOf(engine.root)).toBeUndefined();
  });
});

describe('what a case says on the way', () => {
  it('sits on the tape after the visits before it, in the case it was said in', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const { run } = load(tap.root);
    tap.reset();

    tap.note('before anything ran');
    run(1);
    tap.note('x'.repeat(300));

    const { notes, taped } = tap.read();
    expect(notes.map(([at, key]) => [at, key])).toEqual([[0, 'case'], [taped, 'case']]);
    expect(notes[0]![2]).toBe('before anything ran');
    expect(notes[1]![2]).toHaveLength(240);
    expect(notes[1]![2].endsWith('…')).toBe(true);
  });

  it('is counted, not kept, past the limit, and starts again with the tape', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    for (let said = 0; said < storyTap.NOTE_LIMIT + 3; said += 1) tap.note(`line ${said}`);
    expect(tap.read()).toMatchObject({ unnoted: 3 });
    expect(tap.read().notes).toHaveLength(storyTap.NOTE_LIMIT);

    tap.reset();
    expect(tap.read()).toMatchObject({ notes: [], unnoted: 0 });
  });

  it('arrives from the console, which still prints it, and from the channel other packages call', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const printed: unknown[][] = [];
    const scope: { console: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'> } = {
      console: { ...console, log: (...values: unknown[]) => printed.push(values) },
    };

    storyTap.listen(tap, scope);
    storyTap.listen(tap, scope);
    scope.console.log('stock %d', 0, { sku: 'A1' });
    (scope as unknown as Record<symbol, (text: string) => void>)[Symbol.for('variance-authority.story.note')]!('vae once checkout upsell decided');

    expect(printed).toEqual([['stock %d', 0, { sku: 'A1' }]]);
    // Listening twice wraps the console once, so a line is said once.
    expect(tap.read().notes.map(([, , text]) => text)).toEqual([
      "console.log stock 0 { sku: 'A1' }",
      'vae once checkout upsell decided',
    ]);
  });
});

it.todo('a case run in a page writes its story as a case run in Node does — needs a drain per case in a page, which the `config` hook of the Vitest seam does not install');
