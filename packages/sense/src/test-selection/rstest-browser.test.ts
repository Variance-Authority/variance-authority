import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTestCoverage } from './format.js';
import instrumentModule, { type SelectionLoaderContext } from './rstest-loader.js';
import { withTestSelection, type RstestFileResult } from './rstest.js';

type Hook = (...args: unknown[]) => void;

interface Seam {
  readonly plugin: { setup(api: unknown): void };
  readonly reporter: { onTestRunEnd(payload: { results: readonly RstestFileResult[] }): Promise<void> };
  readonly setup: string;
  readonly coverageFile: string;
}

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function seam(cases = false): Promise<Seam & { root: string }> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-rstest-page-'));
  temporary.push(root);
  const coverageFile = resolve(root, 'coverage.bin');
  const config = withTestSelection({ root }, { coverageFile, include: (file) => file.includes('/src/'), cases });
  return {
    root,
    coverageFile,
    plugin: (config.plugins as Seam['plugin'][]).at(-1)!,
    reporter: (config.reporters as Seam['reporter'][]).at(-1)!,
    setup: (config.setupFiles as string[])[0]!,
  };
}

/** Rsbuild's plugin API as Rstest exposes it, holding the configuration the run merged. */
function api(browser: { enabled?: boolean } | undefined): unknown {
  return {
    useExposed: (id: string) => (id === 'rstest' ? { getRstestConfig: () => ({ browser }) } : undefined),
  };
}

/** What the loader makes of one module, as Rspack would call it. */
function instrumented(file: string, code: string, coverageFile: string): string {
  let out = code;
  const context: SelectionLoaderContext = {
    resourcePath: file,
    getOptions: () => ({ coverageFile }),
    callback: (_error, next) => (out = next),
  };
  instrumentModule.call(context, code);
  return out;
}

/**
 * One test file in a page of its own. Rspack compiles the import of
 * `@rstest/core` to a read of that property of the realm, so the realm is
 * handed the hooks there and the setup module keeps its import as a read.
 */
function page(setup: string, module: string, test: string): { before: Hook; after: Hook } {
  const hooks: Partial<Record<'before' | 'after', Hook>> = {};
  const realm = createContext({
    '@rstest/core': { beforeAll: (hook: Hook) => (hooks.before = hook), afterAll: (hook: Hook) => (hooks.after = hook) },
  });
  runInContext(
    setup.replace(/^import \{ afterAll, beforeAll \} from "@rstest\/core";$/m, 'const { afterAll, beforeAll } = globalThis["@rstest/core"];'),
    realm,
  );
  runInContext(module.replace(/\bexport /g, ''), realm);
  return {
    before: () => hooks.before!(),
    after: (...args) => {
      runInContext(test, realm);
      hooks.after!(...args);
    },
  };
}

const PRICE = 'export function price(amount) { if (amount > 10) { return 1; } return 2; }';

describe('an Rstest file that runs in a page', () => {
  it('swaps in the page setup module when the run says the files run in a page', async () => {
    const { plugin, setup } = await seam();
    const node = await readFile(setup, 'utf8');

    plugin.setup(api(undefined));
    expect(await readFile(setup, 'utf8')).toBe(node);

    // `--browser.enabled` is merged into the configuration Rstest hands its
    // plugins, which is why the seam asks there rather than of what it wrapped.
    plugin.setup(api({ enabled: true }));
    const shim = await readFile(setup, 'utf8');
    expect(shim).not.toContain('node:');
    expect(shim).toContain('from "@rstest/core"');
  });

  it('records the branch each file took, from the context Rstest carries back', async () => {
    const { root, plugin, reporter, setup, coverageFile } = await seam();
    plugin.setup(api({ enabled: true }));
    await mkdir(resolve(root, 'src'));
    const source = resolve(root, 'src/price.js');
    await writeFile(source, `${PRICE}\n`);
    const module = instrumented(source, PRICE, coverageFile);
    const shim = await readFile(setup, 'utf8');

    const finished = async (name: string, test: string): Promise<RstestFileResult> => {
      const testPath = resolve(root, 'src', name);
      await writeFile(testPath, `it("x", () => { ${test} });\n`);
      const run = page(shim, module, test);
      // Rstest hands `afterAll` the file's own context, and reports its `meta`
      // with the file's result.
      const context = { filepath: testPath, meta: {} };
      run.before();
      run.after(context);
      return { testPath, status: 'pass', results: [{ status: 'pass' }], meta: context.meta };
    };

    await reporter.onTestRunEnd({
      results: [await finished('premium.test.js', 'price(20);'), await finished('plain.test.js', 'price(5);')],
    });

    const [price] = decodeTestCoverage(await readFile(coverageFile)).modules;
    expect(price?.blocks.map((block) => [block.path, block.testFiles])).toEqual([
      ['module', ['src/plain.test.js', 'src/premium.test.js']],
      ['entry', ['src/plain.test.js', 'src/premium.test.js']],
      ['if#0/then', ['src/premium.test.js']],
      ['if#0/else', ['src/plain.test.js']],
      ['if#0/after', ['src/plain.test.js']],
    ]);
  });

  it('says it records files only, rather than writing an empty case index', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { plugin, reporter, setup, coverageFile } = await seam(true);

      plugin.setup(api({ enabled: true }));
      expect(await readFile(setup, 'utf8')).not.toContain('wrapCase');
      await reporter.onTestRunEnd({ results: [] });

      expect(warn.mock.calls.flat().join('\n')).toMatch(/a test file that runs in a page is recorded per file, not per case/);
      await expect(readFile(`${coverageFile}.cases.bin`)).rejects.toThrow(/ENOENT/);
    } finally {
      warn.mockRestore();
    }
  });
});
