import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cadence } from './cadence.js';
import { instrument } from './index.js';
import probeCuts from './probe-cuts.cjs';
import probeLog from './probe-log.cjs';

/** The tap as a seam loads it: built, because it `require`s the engine by the built name. */
const storyTap = createRequire(import.meta.url)(
  '../../dist/instrument/story-tap.cjs',
) as typeof import('./story-tap.cjs');

/**
 * The line each region a bucket's read holds was first reached under, by
 * module and ordinal, or `undefined` for a read that carries no lines.
 */
function linesOf(engine: ReturnType<typeof probeLog.createEngine>, bucket: ReturnType<typeof engine.open>) {
  const out = engine.read(bucket, false);
  if (out.lines === undefined) return undefined;
  const lines = new Map<string, number>();
  for (const row of out.rows) {
    for (let at = out.start[row]!; at < out.end[row]!; at += 1) {
      const ordinal = out.sorted[at]! >>> 1;
      lines.set(`${out.ids[row]}#${ordinal}`, out.lines[out.base[row]! + ordinal]!);
    }
  }
  return lines;
}

/** An engine that keeps a test runner's cuts, as a test runner's collector builds it. */
const cutting = (scoped = false) => probeLog.createEngine(scoped, probeCuts.createCuts());

type Root = { r(id: string, count: number): { b: number }; g(entry: number): void; c(line: number): void };

describe('a cut test charges each region to the line that first reached it', () => {
  it('runs a cut test body against instrumented code and names the reaching line', () => {
    const library = instrument(
      'function a() { return 1; }\nfunction b() { return 2; }\nglobalThis.lib = { a, b };\n',
      'lib.js',
    )!;
    const test = cadence(
      "it('t', () => {\n  lib.a();\n  lib.b();\n  lib.a();\n});\n",
      'lib.test.js',
    );
    expect(test).toBeDefined();
    const engine = cutting();
    const loading = engine.open('loading');
    engine.use(loading);
    const context = createContext({ __VA__: engine.root, it: (_: string, body: () => void) => body() });
    runInContext(library.code, context, { filename: 'lib.js' });
    const running = engine.open('case');
    engine.use(running);
    runInContext(test!, context, { filename: 'lib.test.js' });

    const lines = linesOf(engine, running)!;
    const [a, b] = library.blocks.flatMap((block, ordinal) => (block.name === 'a' || block.name === 'b' ? [ordinal] : []));
    expect(lines.get(`lib.js#${a}`)).toBe(2);
    expect(lines.get(`lib.js#${b}`)).toBe(3);
  });

  it('charges what was logged before the first cut to line 0', () => {
    const engine = cutting();
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = engine.root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.g(base + 1);
    root.c(7);
    root.g(base + 2);
    expect(linesOf(engine, bucket)).toEqual(new Map([['m.js#1', 0], ['m.js#2', 7]]));
  });

  it('keeps the line a region was first reached under after the log is compacted', () => {
    const engine = cutting();
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = engine.root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.c(1);
    for (let at = 0; at < 3000; at += 1) root.g(base + 1);
    root.c(2);
    // The log fills past its first size here and is compacted to one entry,
    // so the cut at 3000 has to move with it.
    for (let at = 0; at < 2000; at += 1) root.g(base + 1);
    root.g(base + 2);
    root.c(3);
    root.g(base + 3);
    expect(linesOf(engine, bucket)).toEqual(new Map([['m.js#1', 1], ['m.js#2', 2], ['m.js#3', 3]]));
  });

  it('carries no lines for a bucket nothing cut, which is a read that did not record them', () => {
    const engine = cutting();
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = engine.root as unknown as Root;
    root.g(root.r('m.js', 2).b + 1);
    expect(linesOf(engine, bucket)).toBeUndefined();
  });

  it('charges what a bucket logs after it was read out to the last line it was cut at', () => {
    const engine = cutting();
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = engine.root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.c(5);
    root.g(base + 1);
    root.c(6);
    engine.take(bucket);
    // Work that outlived the case's last statement, written as a later frame.
    root.g(base + 2);
    expect(linesOf(engine, bucket)).toEqual(new Map([['m.js#2', 6]]));
  });

  it('carries no lines for a bucket read out before it was ever cut', () => {
    const engine = cutting();
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = engine.root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.g(base + 1);
    engine.take(bucket);
    root.g(base + 2);
    expect(linesOf(engine, bucket)).toBeUndefined();
  });

  it('keeps no cuts in an engine built without a keeper, as a page builds it', () => {
    const engine = probeLog.createEngine(false);
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = engine.root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.c(5);
    root.g(base + 1);
    expect(linesOf(engine, bucket)).toBeUndefined();
  });

  it('writes the cut into the bucket the async scope names', () => {
    const engine = cutting(true);
    const one = engine.open('one');
    const two = engine.open('two');
    let now = one;
    engine.scope(() => now);
    const root = engine.root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.c(3);
    now = two;
    root.c(9);
    root.g(base + 1);
    expect(linesOf(engine, two)).toEqual(new Map([['m.js#1', 9]]));
    expect(linesOf(engine, one)).toEqual(new Map());
  });

  it('reaches the engine through a story tap', () => {
    const engine = cutting();
    const bucket = engine.open('case');
    engine.use(bucket);
    const root = storyTap.createTap(engine, 16).root as unknown as Root;
    const base = root.r('m.js', 4).b;
    root.c(4);
    root.g(base + 1);
    expect(linesOf(engine, bucket)).toEqual(new Map([['m.js#1', 4]]));
  });
});

describe('a test body registered under another name', () => {
  it.todo('is cut when `test.extend` made the registrar');
  it.todo('is cut when the registrar was imported under another name');
});
