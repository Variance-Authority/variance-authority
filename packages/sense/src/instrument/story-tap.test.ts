import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EVALUATING, instrument } from './index.js';
import probeLists from './probe-lists.cjs';
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
  return probeLists.lists(engine.read(bucket), true);
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
    // Between them, what `cart` and `price` were handed, each after its own entry.
    expect(notes.map(([at, key]) => [at, key])).toEqual([[0, 'case'], [1, 'case'], [2, 'case'], [taped, 'case']]);
    expect(notes.map(([, , text]) => text).slice(0, 3)).toEqual(['before anything ran', 'handed n=1', 'handed n=1']);
    expect(notes[3]![2]).toHaveLength(240);
    expect(notes[3]![2].endsWith('…')).toBe(true);
  });

  it('opens what a test line did with the line, the last of the cuts that did nothing', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const { run } = load(tap.root);
    tap.reset();

    tap.root.c(3);
    run(0);
    tap.root.c(4);
    tap.root.c(5);
    tap.note('said');
    tap.root.c(6);
    tap.note('test line 7');

    // A line is not a note: what the code printed stays what it printed. Each
    // line counts the notes said before it, so one said at the same visit
    // keeps its side of the line.
    const { lines, notes } = tap.read();
    const said = notes.findIndex(([, , text]) => text === 'said');
    expect(lines).toEqual([[0, 'case', 3, 0], [3, 'case', 5, said], [3, 'case', 6, said + 1]]);
    expect(notes.filter(([, , text]) => !text.startsWith('handed')).map(([, , text]) => text)).toEqual(['said', 'test line 7']);

    tap.reset();
    expect(tap.read().lines).toEqual([]);

    // A hook's cut is marked, whichever realm it ran in.
    tap.root.c(8, undefined, true);
    run(0);
    expect(tap.read().lines).toEqual([[0, 'case', 8, 0, 1]]);
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

  it('shows the values a template hands the channel as a region shows what it was handed', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const scope = {};
    storyTap.listen(tap, scope);
    const say = (scope as Record<symbol, (strings: readonly string[], ...values: unknown[]) => void>)[
      Symbol.for('variance-authority.story.note')
    ]!;
    const chosen = function onPickRow(): void {};

    say(['rendered Label — onPick ', ' → ', ', text ', ' → ', ''], chosen, chosen, 'a\nb', 10n);
    say(['rendered Label — onPick ', ''], chosen);

    // The same function is the same ref in both lines, and a string is cut and spelled as the tap spells it.
    expect(tap.read().notes.map(([, , text]) => text)).toEqual([
      "rendered Label — onPick ref1 function onPickRow → ref1 function onPickRow, text 'a\\nb' → 10n",
      'rendered Label — onPick ref1 function onPickRow',
    ]);
  });
});

const HANDED = `
const cart = { items: new Array(1000).fill(0) };
const label = 'x'.repeat(100);
class Till {}
function total(c, { tax }, ...rest) { return c.items.length + tax + rest.length }
function* lines(c) { yield c }
function checkout(n) { out.push(total(cart, { tax: n }, label, new Till())); out.push([...lines(cart)].length) }
`;

/** {@link HANDED} evaluated once against a fresh engine's root, or a tap in front of it. */
function handed(tapped: boolean) {
  const engine = probeLog.createEngine(false);
  engine.use(engine.open('case'));
  const tap = tapped ? storyTap.createTap(engine, storyTap.TAPE_LIMIT) : undefined;
  const context = createContext({ out: [], __VA__: tap?.root ?? engine.root });
  runInContext(instrument(HANDED, 'fixture.js')!.code, context, { filename: 'fixture.js' });
  return { tap, run: (code: string): unknown => runInContext(code, context) };
}

describe('what a function was handed, and what a module holds', () => {
  it('names an object by a ref, the same one wherever it goes, and never its contents', () => {
    const { tap, run } = handed(true);

    run('checkout(2)');

    expect(tap!.read().notes.map(([, , text]) => text)).toEqual([
      `holds cart=ref1 Object, label='${'x'.repeat(39)}…', Till=ref2 class Till, total=ref3 function total, lines=ref4 function lines, checkout=ref5 function checkout`,
      'handed n=2',
      'handed c=ref1 Object, tax=2, rest=ref6 Array(2)',
    ]);
    // A generator's body is left as it was: what it was handed is not asked for.
    expect(run('out')).toEqual([1004, 1]);
  });

  it('names an object by the same ref in a later case, since the realm still holds it', () => {
    const { tap, run } = handed(true);

    run('checkout(2)');
    tap!.reset();
    run('checkout(3)');

    expect(tap!.read().notes.map(([, , text]) => text)).toContain('handed c=ref1 Object, tax=3, rest=ref7 Array(2)');
  });

  it('keeps what each module holds past a reset, since a module runs once and its cases come after', () => {
    const { tap, run } = handed(true);

    tap!.reset();
    run('checkout(2)');

    const { held, notes } = tap!.read();
    expect(notes.map(([, , text]) => text)).not.toContainEqual(expect.stringMatching(/^holds /));
    expect([...held]).toEqual([['fixture.js', expect.stringMatching(/^holds cart=ref1 Object, label=/)]]);
  });

  it('names an object by what its framework calls it, when the framework said so to the realm', () => {
    const engine = probeLog.createEngine(false);
    engine.use(engine.open('case'));
    const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT);
    const branded = (value: object): string | undefined => {
      const brand = Object.getOwnPropertyDescriptor(value, 'brand')?.value;
      return typeof brand === 'string' ? brand : undefined;
    };
    const failing = (): string => {
      throw new Error('a framework that cannot tell');
    };
    const scope = { __VA__: tap.root, [Symbol.for('variance-authority.story.kind')]: [failing, branded] };
    storyTap.listen(tap, scope);
    const source = "const Theme = { brand: 'ui.theme' };\nconst Plain = { other: 1 };\n";
    runInContext(instrument(source, 'fixture.js')!.code, createContext(scope), { filename: 'fixture.js' });

    // A namer that throws is passed over, and an object no namer knows is named as before.
    expect(tap.read().notes.map(([, , text]) => text)).toEqual(['holds Theme=ref1 ui.theme, Plain=ref2 Object']);
  });

  it('never crowds out what the code said, however often a function is handed something', () => {
    const { tap, run } = handed(true);

    for (let call = 0; call <= storyTap.NOTE_LIMIT; call += 1) run('total(cart, { tax: 0 })');
    tap!.note('console.log done');

    const notes = tap!.read().notes.map(([, , text]) => text);
    expect(notes.at(-1)).toBe('console.log done');
    expect(notes.filter((text) => text.startsWith('handed '))).toHaveLength(storyTap.NOTE_LIMIT - 1);
  });

  it('spells a string on one line', () => {
    const { tap, run } = handed(true);

    run(`total(cart, { tax: 'a\\nb' })`);

    expect(tap!.read().notes.at(-1)![2]).toBe("handed c=ref1 Object, tax='a\\nb', rest=ref6 Array(0)");
  });

  it('asks nothing of a module when no story listens', () => {
    const { run } = handed(false);

    run('checkout(2)');

    expect(run('out')).toEqual([1004, 1]);
    expect(run('__vaL')).toBeUndefined();
  });
});
