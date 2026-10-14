import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import instrumentModule from './rstest-loader.js';
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
async function seam(): Promise<Seam & { source: string }> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-rstest-refusals-'));
  temporary.push(root);
  const coverageFile = resolve(root, 'coverage.bin');
  const config = withTestSelection({ root }, { coverageFile, include: (file) => file.includes('/src/') });
  await mkdir(resolve(root, 'src'));
  const source = resolve(root, 'src/price.js');
  await writeFile(source, PRICE);
  return { root, coverageFile, source, reporter: (config.reporters as Seam['reporter'][]).at(-1)! };
}

/** What one loader hands on for `file`: its error, or its text. */
function loaded(loader: typeof probeAfter, file: string, coverageFile: string, code: string): { error: Error | null; code?: string } {
  let answer: { error: Error | null; code?: string } = { error: null };
  loader.call({
    resourcePath: file,
    getOptions: () => ({ coverageFile }),
    callback: (error, next) => (answer = { error, ...(next === undefined ? {} : { code: next }) }),
  }, code);
  return answer;
}

describe('an Rstest module the probes cannot be placed in', () => {
  it('refuses a module SWC rewrote with no map, naming the file and the `devtool` that writes the map', async () => {
    const { coverageFile, source } = await seam();
    // What SWC writes with `devtool: false`: changed lines, and no map.
    const { error } = loaded(probeAfter, source, coverageFile, 'function price(amount) {\n  return amount > 10 ? 1 : 2;\n}\n');
    expect(error?.message).toMatch(/`src\/price\.js`/);
    expect(error?.message).toMatch(/Rspack's `devtool` writing source maps/);
  });

  it('fails the run at its end, naming the loader, where a hand-built config carries the first loader and not the probes loader', async () => {
    const { coverageFile, source, reporter } = await seam();
    expect(loaded(instrumentModule, source, coverageFile, PRICE).error).toBeNull();
    await expect(reporter.onTestRunEnd({ results: [] })).rejects.toThrow(
      /`src\/price\.js` went through `rstest-loader\.js` and never reached `rstest-after-loader\.js`/,
    );
  });

  it('ends the run as usual where the probes loader reached every module the first loader passed on', async () => {
    const { coverageFile, source, reporter } = await seam();
    loaded(instrumentModule, source, coverageFile, PRICE);
    expect(loaded(probeAfter, source, coverageFile, PRICE).error).toBeNull();
    await expect(reporter.onTestRunEnd({ results: [] })).resolves.toBeUndefined();
  });
});
