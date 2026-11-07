import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from 'vitest/config';
import { decodeTestCoverage } from './format.js';
import { withTestSelection } from './vitest.js';

interface Resolved {
  readonly configFile: string | undefined;
  readonly configFileDependencies: readonly string[];
  readonly root?: string;
  readonly test?: { readonly setupFiles?: readonly string[] };
}

interface Seam {
  readonly plugin: { configResolved(config: Resolved): void; configureVitest?(context: object): void; transform?: unknown };
  /** Vite resolves the configuration, Vitest takes the project into the run, and the run starts with a file of it. */
  readonly resolved: (config: Resolved) => void;
  readonly finish: () => Promise<readonly string[]>;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-vitest-preconditions-'));
  for (const file of ['case.test.ts', 'setup.ts', 'vitest.config.ts', 'shared.ts']) {
    await writeFile(resolve(root, file), `// ${file}\n`, 'utf8');
  }
  // A run whose test files instrumented nothing says so, and nothing here
  // instruments: the preconditions are the whole of what is asked.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** The seam's own setup shim, which it writes under the root for every run. */
function setupShim(): string[] {
  return readdirSync(resolve(root, '.variance-authority'))
    .filter((name) => name.startsWith('test-selection-setup-'))
    .map((name) => resolve(root, '.variance-authority', name));
}

/** Configure the seam, and read back the preconditions its recorded run lists. */
function seam(config: UserConfig): Seam {
  const coverageFile = resolve(root, 'coverage.bin');
  const configured = withTestSelection(config, { root, coverageFile, include: () => false });
  const reporter = (configured.test!.reporters as unknown as Array<{
    onFinished(files: readonly unknown[]): Promise<void>;
  }>).at(-1)!;
  const plugin = (configured.plugins as unknown as Array<Seam['plugin'] & { name: string }>).find(({ name }) => name === 'variance-authority:test-selection' || name === 'variance-authority:test-selection-config')!;
  return {
    plugin,
    resolved: (config) => {
      plugin.configResolved(config);
      const project = {};
      const reporters: Array<{ onTestRunStart(specifications: readonly object[]): void }> = [];
      plugin.configureVitest?.({ vitest: { config: { reporters } }, project });
      for (const pushed of reporters) pushed.onTestRunStart([{ project }]);
    },
    finish: async () => {
      await reporter.onFinished([{ filepath: resolve(root, 'case.test.ts'), tasks: [] }]);
      const [test] = decodeTestCoverage(await readFile(coverageFile)).tests;
      return test!.preconditions.map((precondition) => precondition.name).sort();
    },
  };
}

describe('the configuration a Vitest run rests on', () => {
  it('is the config file Vite loaded and the local modules it bundled, beside the setup files', async () => {
    const { resolved, finish } = seam({ test: { setupFiles: ['./setup.ts'] } });

    // Read from the resolved config, where the seam's own shim sits first and
    // is no precondition of anybody's, and a package is no file of the project's.
    resolved({
      configFile: resolve(root, 'vitest.config.ts'),
      configFileDependencies: [resolve(root, 'vitest.config.ts'), resolve(root, 'shared.ts')],
      root,
      test: { setupFiles: [...setupShim(), './setup.ts', 'dotenv/config'] },
    });

    expect(await finish()).toEqual(['case.test.ts', 'setup.ts', 'shared.ts', 'vitest.config.ts']);
  });

  it('is the file that lists the projects, declared by a plugin that transforms nothing', async () => {
    const { plugin, resolved, finish } = seam({ test: { projects: ['packages/*'] } } as unknown as UserConfig);

    resolved({ configFile: resolve(root, 'vitest.config.ts'), configFileDependencies: [] });

    expect(plugin.transform).toBeUndefined();
    expect(await finish()).toEqual(['case.test.ts', 'vitest.config.ts']);
  });

  it('names no file when the configuration was handed over inline', async () => {
    const { resolved, finish } = seam({});

    resolved({ configFile: undefined, configFileDependencies: [] });

    expect(await finish()).toEqual(['case.test.ts']);
  });
});
