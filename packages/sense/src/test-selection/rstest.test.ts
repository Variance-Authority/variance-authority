import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { statusesComplete } from './finished-files.js';
import { runOf } from './selection-run.js';
import { SELECTION_LOADER, withTestSelection } from './rstest.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-config-'));
  temporary.push(directory);
  return directory;
}

interface Rules {
  readonly module: { readonly rules: ReadonlyArray<{ readonly enforce?: string; readonly use: ReadonlyArray<{ readonly loader: string; readonly options: { readonly coverageFile: string } }> }> };
}

describe('what a wrapped Rstest configuration becomes', () => {
  it('adds a post loader carrying the snapshot the reporter will write, without replacing the project\'s own', async () => {
    const directory = await root();
    const coverageFile = resolve(directory, 'coverage.bin');
    const mine = { module: { rules: [] } };
    const config = withTestSelection(
      { root: directory, tools: { rspack: mine, swc: {} } },
      { coverageFile },
    );

    const rspack = (config.tools as { rspack: readonly unknown[] }).rspack;
    expect(rspack[0]).toBe(mine);
    // `tools.swc` is the project's and is untouched: a seam that spread only
    // the key it writes would drop every sibling.
    expect((config.tools as { swc?: unknown }).swc).toEqual({});

    const rule = (rspack[1] as Rules).module.rules[0]!;
    // After the project's loaders and after SWC, so the probes land on
    // JavaScript and the map back to the author's lines is the bundler's own.
    expect(rule.enforce).toBe('post');
    expect(rule.use[0]!.loader).toBe(SELECTION_LOADER);
    // The one string that names a run: a loader is loaded by path and can be
    // handed options, never the object the configuration built.
    expect(rule.use[0]!.options.coverageFile).toBe(coverageFile);
    expect(runOf(coverageFile)?.root).toBe(directory);
  });

  it('puts its setup shim first and keeps the project\'s, and imports the runner Rstest spells', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory, setupFiles: './test/setup.mjs' },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );

    const setupFiles = config.setupFiles as readonly string[];
    expect(setupFiles).toHaveLength(2);
    expect(setupFiles[1]).toBe('./test/setup.mjs');
    // First, so a setup file of the project's that loads an instrumented
    // module finds the probe log its header resolves.
    const shim = await readFile(setupFiles[0]!, 'utf8');
    expect(shim).toContain("from \"@rstest/core\"");
    // Every run records cases, so the shim wraps the injected registrars.
    expect(shim).toContain('wrapCase');
  });

  it('wraps the registrars a suite imports, which is a configuration without globals', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );
    const shim = await readFile((config.setupFiles as readonly string[])[0]!, 'utf8');
    expect(shim).toContain('wrapCase');
    // `@rstest/core` is an Rspack external of type `global`, so an import of it
    // is a read of this property and wrapping the property is wrapping the
    // import. Nothing about it is configured, which is why recording cases asks
    // the project for nothing.
    expect(shim).toContain('globalThis["@rstest/core"]');
  });

  it('wraps the registrars on the realm as well, for a suite that runs with globals', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory, globals: true },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );
    const shim = await readFile((config.setupFiles as readonly string[])[0]!, 'utf8');
    // Both holders, in one shim: a suite may spell it either way, file by file,
    // and the seam is not told which.
    expect(shim).toContain('for (const holder of [globalThis, globalThis["@rstest/core"]])');
  });

  it('gives a projects layout the reporter and nothing else, since nothing is bundled under it', async () => {
    const directory = await root();
    const config = withTestSelection(
      { root: directory, projects: ['./packages/*'] },
      { coverageFile: resolve(directory, 'coverage.bin') },
    );
    expect(config.setupFiles).toBeUndefined();
    expect(config.tools).toBeUndefined();
    expect((config.reporters as readonly unknown[])).toHaveLength(2);
  });
});

describe('what a finished Rstest file is worth', () => {
  // A `beforeAll` that throws leaves the file failed and every test in it
  // skipped, which read leaf by leaf is the shape of a file that ran
  // everything it meant to. The file's own status is what tells them apart.
  it('refuses a file whose fixture threw, and keeps one whose tests were skipped by their own text', () => {
    expect(statusesComplete('fail', ['pass', 'skip'])).toBe(false);
    expect(statusesComplete('pass', ['pass', 'skip', 'todo'])).toBe(true);
    expect(statusesComplete('pass', ['pass', 'fail'])).toBe(false);
    // Nothing ran, so there is nothing to be evidence of.
    expect(statusesComplete('pass', [])).toBe(false);
  });
});
