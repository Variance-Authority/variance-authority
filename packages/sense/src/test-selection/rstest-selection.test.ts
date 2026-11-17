import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { glob } from 'tinyglobby';
import { afterAll, describe, expect, it } from 'vitest';
import { excluded, selectionPlugins } from './rstest-selection.js';

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

  it.each([[['watch']], [['-w']], [['--watch']], [['alpha', '--watch']]])(
    'does not select under watch mode, %j, and says so',
    (argv) => {
      expect(plugins(argv)).toEqual({ found: [], said: ['variance-authority: watch mode does not select'] });
    },
  );

  it('refuses `VARIANCE_AUTHORITY_GRAIN=case` when the configuration loads, not when Rstest plans', () => {
    expect(() => plugins(['run'], { VARIANCE_AUTHORITY_GRAIN: 'case' })).toThrow(/GRAIN=case is not kept under Rstest/);
  });
});

describe('the files a selection skips, as `exclude` patterns', () => {
  const base = mkdtempSync(join(tmpdir(), 'variance-authority-rstest-exclude-'));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const skipped = ['test/[id]/page.test.ts', 'test/a,b.test.ts', 'test/{x}.test.ts', 'test/(y)!.test.ts', '../shared/s.test.ts'];
  const others = ['test/i/page.test.ts', 'test/a.test.ts', 'test/x.test.ts', 'test/y.test.ts', '../shared/t.test.ts'];

  it.each([['plain'], ['@scope/name'], ['a+b,c']])(
    'leave out each skipped file under a root named %s, however its name reads as a glob, and no other',
    async (name) => {
      const root = join(base, name, 'project');
      for (const file of [...skipped, ...others]) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), '');
      }
      const options = { cwd: root, dot: true, expandDirectories: false };
      const include = ['test/**/*.test.ts', '../shared/*.test.ts'];

      const left = await glob(include, { ...options, ignore: excluded(root, skipped.map((file) => join(root, file))) });

      expect(left.sort()).toEqual([...others].sort());
    },
  );

  it('stay a handful of patterns for thousands of files', () => {
    const many = Array.from({ length: 25_000 }, (_, index) => `/checkout/packages/p${index % 50}/test/case-${index}.test.ts`);

    expect(excluded('/checkout', many).length).toBeLessThan(25);
  });
});
