import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { moduleId } from './captured-modules.js';
import { keepsCases } from './case-record.js';
import { decodeTestCoverage } from './format.js';
import { carriedJournal, type ReportedModule } from './finished-files.js';
import { withTestSelection } from './vitest.js';
import { BROWSER_JOURNAL } from './worker-source.js';
import { STORY_VARIABLE, storyDirectory } from '../story/directory.js';

/** Built, as `format.test.ts` reads it: the format `require`s its neighbours by the names the build gives them. */
const { decodeStory } = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');

type Hook = (...args: unknown[]) => void;

interface Seam {
  readonly plugin: {
    config(config: { test: { browser: { enabled: boolean }; runner?: string } }): Promise<void>;
    transform: { handler(code: string, id: string): { code: string } | null };
  };
  readonly reporter: { onTestRunEnd(modules: readonly ReportedModule[]): Promise<void> };
  readonly setup: string;
  readonly runner: string | undefined;
}

function seam(root: string, cases = false, seamOf: typeof withTestSelection = withTestSelection): Seam {
  const configured = seamOf(
    {},
    { root, coverageFile: resolve(root, 'coverage.bin'), include: (file) => file.includes('/src/'), cases },
  );
  return {
    plugin: (configured.plugins as unknown as Seam['plugin'][])[0]!,
    reporter: (configured.test!.reporters as unknown as Seam['reporter'][]).at(-1)!,
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

/** `path` under `root`, written with `text`: the file a transform is handed a module of. */
async function held(root: string, path: string, text: string): Promise<string> {
  const file = resolve(root, path);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, text);
  return file;
}

const PRICE = 'export function price(amount) { if (amount > 10) { return 1; } return 2; }';

describe('a test file that runs in a page', () => {
  it('hands the runner what it ran on the file task, since a page has nowhere to write it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-page-'));
    try {
      const { plugin, setup } = seam(root);
      await plugin.config({ test: { browser: { enabled: true } } });
      const instrumented = plugin.transform.handler(PRICE, await held(root, 'src/price.ts', PRICE))!.code;
      const run = page(await readFile(setup, 'utf8'), instrumented, 'price(20);');
      const file = { type: 'suite', filepath: resolve(root, 'src/premium.test.ts') } as { meta?: object };

      run.before();
      run.after(file);

      const { journal } = carriedJournal('src/premium.test.ts', file.meta);
      // Loading the module entered its header, which every file that loads it
      // shares; the test entered the function and the branch it took.
      expect(journal?.modules).toEqual([
        { id: moduleId('src/price.ts', PRICE), hits: [0, 1, 2], shared: [0], loaded: [0] },
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
      await plugin.config({ test: { browser: { enabled: true } } });
      const instrumented = plugin.transform.handler(PRICE, await held(root, 'src/price.ts', PRICE))!.code;
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
      await plugin.config({ test: { browser: { enabled: true } } });
      const instrumented = plugin.transform.handler(PRICE, await held(root, 'src/price.ts', PRICE))!.code;
      const shim = await readFile(setup, 'utf8');
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

  it('drops the case runner and says it records files only, rather than keeping an empty index in the record', async () => {
    // An index with no case in it answers *which cases walk this line* with
    // none, which is a wrong answer rather than a missing one.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-cases-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { plugin, reporter, runner } = seam(root, true);
      const config = { test: { browser: { enabled: true }, ...(runner === undefined ? {} : { runner }) } };

      await plugin.config(config);
      await reporter.onTestRunEnd([]);

      expect(config.test).not.toHaveProperty('runner');
      expect(warn.mock.calls.flat().join('\n')).toMatch(/a test file that runs in a page is recorded per file, not per case/);
      expect(keepsCases(resolve(root, 'coverage.bin'))).toBe(false);
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a module `include` refuses as the transforms wrote it, unprobed', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-'));
    try {
      await mkdir(resolve(root, 'vendor'), { recursive: true });
      const vendor = resolve(root, 'vendor/pad.ts');
      const source = 'export const pad = (text) => ` ${text}`;\n';
      await writeFile(vendor, source, 'utf8');
      const { plugin } = seam(root);
      await plugin.config({ test: { browser: { enabled: true } } });
      const inside = resolve(root, 'src/pad.ts');
      await mkdir(resolve(root, 'src'), { recursive: true });
      await writeFile(inside, source, 'utf8');

      expect(plugin.transform.handler(source, vendor)).toBeNull();
      // The same text under `include` is probed, so the refusal is what left it.
      expect(plugin.transform.handler(source, inside)?.code).toMatch(/__va\(/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a file that runs in Node to the worker that writes its own', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-node-'));
    try {
      const { plugin, setup } = seam(root);
      const before = await readFile(setup, 'utf8');

      await plugin.config({ test: { browser: { enabled: false } } });

      expect(await readFile(setup, 'utf8')).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a case that runs in a page, when stories are asked', () => {
  it('writes its story, read as a case in Node writes one: the regions it entered under each test line, what it printed, how it ended', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-browser-story-'));
    vi.stubEnv(STORY_VARIABLE, '1');
    try {
      // Built: what the page is sent, and what writes the story, read their tap and format from the build.
      const built = (await import('../../dist/test-selection/vitest.js')) as typeof import('./vitest.js');
      const { plugin, reporter, setup } = seam(root, true, built.withTestSelection);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await plugin.config({ test: { browser: { enabled: true } } });
      warn.mockRestore();
      const instrumented = plugin.transform.handler(PRICE, await held(root, 'src/price.ts', PRICE))!.code;
      const hooks: Partial<Record<'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach', Hook>> = {};
      const printed: unknown[] = [];
      const realm: Record<string, unknown> = createContext({
        hooks: Object.fromEntries((['beforeAll', 'afterAll', 'beforeEach', 'afterEach'] as const).map((name) => [name, (hook: Hook) => (hooks[name] = hook)])),
        console: { log: (...values: unknown[]) => printed.push(values) },
      });
      runInContext((await readFile(setup, 'utf8')).replace(/^import \{ ([^}]+) \} from "vitest";$/m, 'const { $1 } = hooks;'), realm);
      runInContext(instrumented.replace(/\bexport /g, ''), realm);
      const CASE = 'it("charges a premium", () => {\n  price(20);\n  console.log("charged", 1);\n});\n';
      const filepath = await held(root, 'src/premium.test.ts', CASE);
      // The page runs the test file as the plugin cut it, so each statement says its line.
      let body: (() => void) | undefined;
      realm['it'] = (_name: string, fn: () => void) => (body = fn);
      const cutCase = (plugin.transform.handler(CASE, filepath) ?? { code: CASE }).code;
      runInContext(cutCase, realm);
      const file = { type: 'suite', filepath, name: 'src/premium.test.ts' } as { meta?: object };
      const suite = { type: 'suite', name: 'checkout', file, suite: file };
      const test = { type: 'test', id: 'a1_0', name: 'charges a premium', file, suite } as { meta?: Record<string, unknown> };

      hooks.beforeAll!();
      hooks.beforeEach!({ task: test });
      body!();
      hooks.afterEach!({ task: test });
      hooks.afterAll!(file);
      await reporter.onTestRunEnd([{
        moduleId: filepath,
        ok: () => false,
        meta: () => file.meta!,
        children: { allTests: () => [{ id: 'a1_0', result: () => ({ state: 'failed' }), meta: () => test.meta! }] },
      } as ReportedModule]);

      const directory = storyDirectory(resolve(root, 'coverage.bin'));
      const [only, ...more] = await readdir(directory);
      expect(more).toEqual([]);
      const story = decodeStory(await readFile(resolve(directory, only!)));
      expect(story).toMatchObject({ file: filepath, name: 'checkout > charges a premium', stopped: true });
      expect(story.lines.map(([, line]) => line)).toEqual([2, 3]);
      expect(story.notes.map(([, text]) => text)).toEqual(['handed amount=20', 'console.log charged 1']);
      // What was handed came under line 2, and what it printed under line 3.
      expect(story.lines.map(([, , said]) => said)).toEqual([0, 1]);
      expect(story.visits.length).toBeGreaterThan(0);
      // The page still printed it.
      expect(printed).toEqual([['charged', 1]]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});

it.todo(
  'a module run in a page is probed after the transforms, as one run in Node is — needs `vi.mock`’s mock, loaded under the file’s name in a page, carried back to the file (FIXME on `late` in vitest-plugin.ts)',
);
