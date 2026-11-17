import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { selectingPlugin, selectionPlugins } from './rstest-selection.js';

const handed = { selection: async () => ({ skip: new Set<string>() }) } as never;

function plugins(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const said: string[] = [];
  const found = selectionPlugins(handed, '/checkout/coverage.bin', '/checkout', '/checkout', {
    argv: ['node', 'rstest', ...argv],
    env,
    say: (line) => said.push(line),
  });
  return { found, said };
}

describe('the Rstest selection', () => {
  it('selects under `rstest run`', () => {
    expect(plugins(['run']).found).toHaveLength(1);
  });

  it.each([[['watch']], [['-w']], [['--watch']], [['alpha', '--watch']], [['--config=rstest.config.mjs', 'watch']], [['-c', 'rstest.config.mjs', 'watch']]])(
    'does not select under watch mode, %j, and says so',
    (argv) => {
      expect(plugins(argv)).toEqual({ found: [], said: ['variance-authority: watch mode does not select'] });
    },
  );

  it('refuses `VARIANCE_AUTHORITY_GRAIN=case` when the configuration loads, not when Rstest plans', () => {
    expect(() => plugins(['run'], { VARIANCE_AUTHORITY_GRAIN: 'case' })).toThrow(/GRAIN=case is not kept under Rstest/);
  });
});

describe('the configuration a selection hands Rstest', () => {
  const root = mkdtempSync(join(tmpdir(), 'variance-authority-rstest-planned-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'test'));
  for (const file of ['alpha', 'beta']) writeFileSync(join(root, 'test', `${file}.test.ts`), '');

  /** The configuration Rstest plans with once the plugin has run on `include` under `at`, skipping `skip`, under `argv`. */
  async function planned(include: string[], skip: string[], argv: string[] = [], at = root) {
    const config = { root: at, include, exclude: { patterns: [] as string[] } } as {
      root: string;
      include: string[];
      exclude: { patterns: string[] };
      passWithNoTests?: boolean;
    };
    let modify: ((config: never) => Promise<void>) | undefined;
    const selection = async () => ({ whole: new Set(['test/alpha.test.ts', 'test/beta.test.ts']), skip: new Set(skip), notes: [] });
    selectingPlugin(selection, at, ['node', 'rstest', 'run', ...argv]).setup({
      useExposed: () => ({ modifyRstestConfig: (callback) => void (modify = callback as never) }),
    });
    await modify!(config as never);
    return config;
  }

  it('leaves a file with no test failing when the selection keeps every file', async () => {
    expect((await planned(['test/*.test.ts'], [])).passWithNoTests).toBeUndefined();
  });

  it('leaves a file with no test failing when the selection skips some and the command line narrows nothing', async () => {
    expect((await planned(['test/*.test.ts'], ['test/beta.test.ts'])).passWithNoTests).toBeUndefined();
  });

  it.each([[['beta']], [['--shard=2/2']], [['--shard', '2/2']]])(
    'passes a run %j narrows to files the selection may all have skipped',
    async (argv) => {
      expect((await planned(['test/*.test.ts'], ['test/beta.test.ts'], argv)).passWithNoTests).toBe(true);
    },
  );

  it('takes a skipped entry that names no file on disk out of `include`, which `exclude` does not reach', async () => {
    const config = await planned(['test/*.test.ts', 'virtual/v.test.ts'], ['virtual/v.test.ts']);

    expect(config.include).toEqual(['test/*.test.ts']);
  });

  it('resolves a `<rootDir>` entry under a root with a drive letter as Rstest does on Windows', async () => {
    const config = await planned(['C:/checkout/virtual/v.test.ts'], ['virtual/v.test.ts'], [], 'C:/checkout');

    expect(config).toMatchObject({ include: [], passWithNoTests: true });
  });
});
