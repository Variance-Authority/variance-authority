import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import MagicString from 'magic-string';
import { afterEach, describe, expect, it } from 'vitest';
import instrumentModule from './rstest-loader.js';
import { AFTER_LOADER, SELECTION_LOADER } from './rstest-loaders.js';
import probeAfter from './rstest-after-loader.js';
import { withTestSelection, type RstestFileResult } from './rstest.js';

interface Seam {
  readonly root: string;
  readonly coverageFile: string;
  readonly reporter: { onTestRunEnd(payload: { results: readonly RstestFileResult[] }): Promise<void> };
}

const PRICE = 'export function price(amount) { if (amount > 10) { return 1; } return 2; }\n';
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A run the seam opened, with `src/price.js` on disk. */
async function seam(include: (file: string) => boolean = (file) => file.includes('/src/')): Promise<Seam & { source: string }> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-rstest-refusals-'));
  temporary.push(root);
  const coverageFile = resolve(root, 'coverage.bin');
  const config = withTestSelection({ root }, { coverageFile, include });
  await mkdir(resolve(root, 'src'));
  const source = resolve(root, 'src/price.js');
  await writeFile(source, PRICE);
  return { root, coverageFile, source, reporter: (config.reporters as Seam['reporter'][]).at(-1)! };
}

/** What one loader hands on for `file`: its error, or its text. `loaders` are the ones Rspack says run on it. */
function loaded(
  loader: typeof probeAfter,
  file: string,
  coverageFile: string,
  code: string,
  loaders?: readonly string[],
  map?: object,
): { error: Error | null; code?: string; map?: unknown } {
  let answer: { error: Error | null; code?: string; map?: unknown } = { error: null };
  loader.call({
    resourcePath: file,
    ...(loaders === undefined ? {} : { loaders: loaders.map((path) => ({ path })) }),
    getOptions: () => ({ coverageFile }),
    callback: (error, next, handed) => (answer = { error, ...(next === undefined ? {} : { code: next }), ...(handed == null ? {} : { map: handed }) }),
  }, code, map as never);
  return answer;
}

describe('an Rstest module the probes cannot be placed in', () => {
  it('fails loudly, naming the file and why, where the file is on disk and cannot be read', async () => {
    const { coverageFile, source } = await seam();
    // A directory where the file was: unreadable to every user, root included.
    await rm(source);
    await mkdir(source);
    const { error } = loaded(probeAfter, source, coverageFile, PRICE);
    expect(error?.message).toMatch(/src\/price\.js.*EISDIR/s);
  });

  it('refuses a module SWC rewrote with no map, naming the file and the `devtool` that writes the map', async () => {
    const { coverageFile, source } = await seam();
    // What SWC writes with `devtool: false`: changed lines, and no map.
    const { error } = loaded(probeAfter, source, coverageFile, 'function price(amount) {\n  return amount > 10 ? 1 : 2;\n}\n');
    expect(error?.message).toMatch(/`src\/price\.js`/);
    expect(error?.message).toMatch(/Rspack's `devtool` writing source maps/);
  });

  it('refuses a module whose map leads back to no source that is the file', async () => {
    const { coverageFile, source } = await seam();
    const map = { version: 3, sources: ['elsewhere.js'], names: [], mappings: 'AAAA' };
    const { error } = loaded(probeAfter, source, coverageFile, `\n${PRICE}`, undefined, map);
    expect(error?.message).toMatch(/`src\/price\.js`: the transforms ahead of the probes rewrote the file and left no map back to it/);
  });

  it('fails the run at its end, naming the loader, where a hand-built config carries the first loader and not the probes loader', async () => {
    const { coverageFile, source, reporter } = await seam();
    expect(loaded(instrumentModule, source, coverageFile, PRICE).error).toBeNull();
    await expect(reporter.onTestRunEnd({ results: [] })).rejects.toThrow(
      /`src\/price\.js` went through `rstest-loader\.js` and never reached `rstest-after-loader\.js`/,
    );
  });

  it('fails the run at its end for a file `include` leaves out, where the probes loader never ran at all', async () => {
    const { root, coverageFile, reporter } = await seam();
    const outside = resolve(root, 'helper.js');
    await writeFile(outside, PRICE);
    expect(loaded(instrumentModule, outside, coverageFile, PRICE).error).toBeNull();
    await expect(reporter.onTestRunEnd({ results: [] })).rejects.toThrow(/`helper\.js` went through `rstest-loader\.js`/);
  });

  it('refuses the first file, before the run, where Rspack names the loaders it runs through and the probes loader is not one', async () => {
    const { coverageFile, source } = await seam();
    const { error } = loaded(instrumentModule, source, coverageFile, PRICE, [SELECTION_LOADER]);
    expect(error?.message).toMatch(/`src\/price\.js` went through `rstest-loader\.js` and never reached `rstest-after-loader\.js`/);
  });

  it('passes a file on where Rspack names the probes loader among the loaders it runs through', async () => {
    const { coverageFile, source } = await seam();
    expect(loaded(instrumentModule, source, coverageFile, PRICE, [SELECTION_LOADER, AFTER_LOADER]).error).toBeNull();
  });

  it('ends the run as usual where the probes loader reached every module the first loader passed on', async () => {
    const { coverageFile, source, reporter } = await seam();
    loaded(instrumentModule, source, coverageFile, PRICE);
    expect(loaded(probeAfter, source, coverageFile, PRICE).error).toBeNull();
    await expect(reporter.onTestRunEnd({ results: [] })).resolves.toBeUndefined();
  });
});

/** `text` with a directive written ahead of it, as a loader writes it. */
function rewritten(text: string): MagicString {
  return new MagicString(text).prepend("'use strict';\n");
}

describe('an Rstest module the probes go into', () => {
  it('passes untouched a setup file Rstest serves from a `data:` URL, which no file on disk holds', async () => {
    // Rstest serves a `data:` setup file as a virtual module under `.rstest-virtual`.
    const { root, coverageFile } = await seam(() => true);
    const virtual = resolve(root, '.rstest-virtual/setup.mjs');
    const map = { version: 3, sources: [virtual], names: [], mappings: 'AAAA' };
    const { error, code, map: handed } = loaded(probeAfter, virtual, coverageFile, PRICE, undefined, map);
    expect(error).toBeNull();
    expect(code).toBe(PRICE);
    expect(handed).toBe(map);
  });

  it('reads a map handed on as its JSON text, as one handed on as an object', async () => {
    const { coverageFile, source } = await seam();
    const written = rewritten(PRICE);
    const map = written.generateMap({ source, hires: true }).toString();
    const { error, code, map: handed } = loaded(probeAfter, source, coverageFile, written.toString(), undefined, map as never);
    expect(error).toBeNull();
    expect(code).toMatch(/if \(amount > 10\) \{\s*__va\(\d+\);/);
    expect(handed).toMatchObject({ sources: [source] });
  });

  it('hands the map on as it came where the loaders before it changed nothing', async () => {
    const { coverageFile, source } = await seam();
    const map = { version: 3, sources: [source], names: [], mappings: 'AAAA' };
    const { error, code, map: handed } = loaded(probeAfter, source, coverageFile, PRICE, undefined, map);
    expect(error).toBeNull();
    expect(code).toMatch(/\.r\("src\/price\.js@[0-9a-f]{32}"/);
    expect(handed).toBe(map);
  });
});
