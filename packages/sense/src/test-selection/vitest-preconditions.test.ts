import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from 'vitest/config';
import { decodeTestCoverage } from './format.js';
import { withTestSelection } from './vitest.js';

interface Resolved {
  readonly configFile: string | undefined;
  readonly configFileDependencies: readonly string[];
}

interface Seam {
  readonly plugin: { configResolved(config: Resolved): void; transform?: unknown };
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

/** Configure the seam, and read back the preconditions its recorded run lists. */
function seam(config: UserConfig): Seam {
  const coverageFile = resolve(root, 'coverage.bin');
  const configured = withTestSelection(config, { root, coverageFile, include: () => false });
  const reporter = (configured.test!.reporters as unknown as Array<{
    onFinished(files: readonly unknown[]): Promise<void>;
  }>)[1]!;
  return {
    plugin: (configured.plugins as unknown as Seam['plugin'][]).at(-1)!,
    finish: async () => {
      await reporter.onFinished([{ filepath: resolve(root, 'case.test.ts'), tasks: [] }]);
      const [test] = decodeTestCoverage(await readFile(coverageFile)).tests;
      return test!.preconditions.map((precondition) => precondition.name).sort();
    },
  };
}

describe('the configuration a Vitest run rests on', () => {
  it('is the config file Vite loaded and the local modules it bundled, beside the setup files', async () => {
    const { plugin, finish } = seam({ test: { setupFiles: ['./setup.ts'] } });

    plugin.configResolved({
      configFile: resolve(root, 'vitest.config.ts'),
      configFileDependencies: [resolve(root, 'vitest.config.ts'), resolve(root, 'shared.ts')],
    });

    expect(await finish()).toEqual(['case.test.ts', 'setup.ts', 'shared.ts', 'vitest.config.ts']);
  });

  it('is the file that lists the projects, declared by a plugin that transforms nothing', async () => {
    const { plugin, finish } = seam({ test: { projects: ['packages/*'] } } as unknown as UserConfig);

    plugin.configResolved({ configFile: resolve(root, 'vitest.config.ts'), configFileDependencies: [] });

    expect(plugin.transform).toBeUndefined();
    expect(await finish()).toEqual(['case.test.ts', 'vitest.config.ts']);
  });

  it('names no file when the configuration was handed over inline', async () => {
    const { plugin, finish } = seam({});

    plugin.configResolved({ configFile: undefined, configFileDependencies: [] });

    expect(await finish()).toEqual(['case.test.ts']);
  });
});
