import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { decodeTestCoverage } from './format.js';
import { carriedJournal, type ReportedModule } from './finished-files.js';
import { withTestSelection } from './vitest.js';
import { BROWSER_JOURNAL } from './worker-source.js';

type Hook = (...args: unknown[]) => void;

interface Seam {
  readonly plugin: {
    config(config: { test: { browser: { enabled: boolean }; runner?: string } }): void;
    transform(code: string, id: string): { code: string } | null;
  };
  readonly reporter: { onTestRunEnd(modules: readonly ReportedModule[]): Promise<void> };
  readonly setup: string;
  readonly runner: string | undefined;
}

function seam(root: string, cases = false): Seam {
  const configured = withTestSelection(
    {},
    { root, coverageFile: resolve(root, 'coverage.bin'), include: (file) => file.includes('/src/'), cases },
  );
  return {
    plugin: (configured.plugins as unknown as Seam['plugin'][])[0]!,
    reporter: (configured.test!.reporters as unknown as Seam['reporter'][])[1]!,
    setup: (configured.test!.setupFiles as string[])[0]!,
    runner: configured.test!.runner as string | undefined,
  };
}

/**
 * One test file in a page of its own: the setup module the seam wrote, then
 * the instrumented module the file imports, then the file's one test.
 *
 * A fresh realm is the page. It has no `require`, no `process` and no disk, and
 * nothing this process installed is in it — so a collector the setup module
 * found already there would be this suite's own, and it would find none.
 */
function page(setup: string, instrumented: string, test: string): { before: Hook; after: Hook } {
  const hooks: Partial<Record<'before' | 'after', Hook>> = {};
  const realm = createContext({
    hooks: { beforeAll: (hook: Hook) => (hooks.before = hook), afterAll: (hook: Hook) => (hooks.after = hook) },
  });
  // The one import the page module keeps is the runner's, which is the one
  // thing the realm is handed rather than given.
  runInContext(setup.replace(/^import \{ afterAll, beforeAll \} from "vitest";$/m, 'const { afterAll, beforeAll } = hooks;'), realm);
  runInContext(instrumented.replace(/\bexport /g, ''), realm);
  return {
    before: () => hooks.before!(),
    after: (...args) => {
      runInContext(test, realm);
      hooks.after!(...args);
    },
  };
}

const PRICE = 'export function price(amount) { if (amount > 10) { return 1; } return 2; }';

describe('a test file that runs in a page', () => {
  it('hands the runner what it ran on the file task, since a page has nowhere to write it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-page-'));
    try {
      const { plugin, setup } = seam(root);
      plugin.config({ test: { browser: { enabled: true } } });
      const instrumented = plugin.transform(PRICE, resolve(root, 'src/price.ts'))!.code;
      const run = page(await readFile(setup, 'utf8'), instrumented, 'price(20);');
      const file = { type: 'suite', filepath: resolve(root, 'src/premium.test.ts') } as { meta?: object };

      run.before();
      run.after(file);

      const journal = carriedJournal('src/premium.test.ts', (file.meta as Record<string, unknown>)[BROWSER_JOURNAL]);
      // Loading the module entered its header, which every file that loads it
      // shares; the test entered the function and the branch it took.
      expect(journal?.modules).toEqual([
        { id: 'src/price.ts', hits: [0, 1, 2], shared: [0], loaded: [0] },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('finds the file task whichever argument the runner puts it in', async () => {
    // Vitest 5 hands `afterAll` a fixture context first and the suite second,
    // and refuses a hook that names its first parameter without destructuring
    // it — so the hook names none and looks.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-argument-'));
    try {
      const { plugin, setup } = seam(root);
      plugin.config({ test: { browser: { enabled: true } } });
      const instrumented = plugin.transform(PRICE, resolve(root, 'src/price.ts'))!.code;
      const run = page(await readFile(setup, 'utf8'), instrumented, 'price(5);');
      const file = { type: 'suite', filepath: resolve(root, 'src/plain.test.ts') } as { meta?: object };

      run.before();
      run.after({ task: { type: 'test' } }, file);

      expect(file.meta).toHaveProperty(BROWSER_JOURNAL);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records the branch each file took, from what the runner carried back', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-record-'));
    try {
      const { plugin, reporter, setup } = seam(root);
      plugin.config({ test: { browser: { enabled: true } } });
      const instrumented = plugin.transform(PRICE, resolve(root, 'src/price.ts'))!.code;
      const shim = await readFile(setup, 'utf8');
      await mkdir(resolve(root, 'src'));
      const finished = async (name: string, test: string): Promise<ReportedModule> => {
        const filepath = resolve(root, 'src', name);
        await writeFile(filepath, `it("x", () => { ${test} });\n`);
        const run = page(shim, instrumented, test);
        const file = { type: 'suite', filepath } as { meta?: object };
        run.before();
        run.after(file);
        return {
          moduleId: filepath,
          ok: () => true,
          meta: () => file.meta!,
          children: { allTests: () => [{ result: () => ({ state: 'passed' }) }] },
        };
      };

      await reporter.onTestRunEnd([
        await finished('premium.test.ts', 'price(20);'),
        await finished('plain.test.ts', 'price(5);'),
      ]);

      const [price] = decodeTestCoverage(await readFile(resolve(root, 'coverage.bin'))).modules;
      expect(price?.blocks.map((block) => [block.path, block.testFiles])).toEqual([
        ['module', ['src/plain.test.ts', 'src/premium.test.ts']],
        ['entry', ['src/plain.test.ts', 'src/premium.test.ts']],
        ['if#0/then', ['src/premium.test.ts']],
        ['if#0/else', ['src/plain.test.ts']],
        ['if#0/after', ['src/plain.test.ts']],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('drops the case runner and says it records files only, rather than writing an empty index', async () => {
    // An index with no case in it answers *which cases walk this line* with
    // none, which is a wrong answer rather than a missing one.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-cases-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { plugin, reporter, runner } = seam(root, true);
      const config = { test: { browser: { enabled: true }, ...(runner === undefined ? {} : { runner }) } };

      plugin.config(config);
      await reporter.onTestRunEnd([]);

      expect(config.test).not.toHaveProperty('runner');
      expect(warn.mock.calls.flat().join('\n')).toMatch(/`cases` is not recorded for a test file that runs in a page/);
      await expect(readFile(resolve(root, 'coverage.bin.cases.bin'))).rejects.toThrow(/ENOENT/);
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a file that runs in Node to the worker that writes its own', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-node-'));
    try {
      const { plugin, setup } = seam(root);
      const before = await readFile(setup, 'utf8');

      plugin.config({ test: { browser: { enabled: false } } });

      expect(await readFile(setup, 'utf8')).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
