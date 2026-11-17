import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';
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
  const skipped = ['/checkout/app/[id]/page.test.ts', '/checkout/app/a,b.test.ts', '/checkout/lib/{x}.test.ts', '/checkout/lib/(y)!.test.ts'];
  const others = ['/checkout/app/i/page.test.ts', '/checkout/app/a.test.ts', '/checkout/lib/x.test.ts', '/checkout/lib/y.test.ts'];

  it('match each skipped file, however its name reads as a glob, and no other', () => {
    const matches = picomatch(excluded(skipped), { dot: true });

    expect([...skipped, ...others].filter((path) => matches(path))).toEqual(skipped);
  });

  it('stay a handful of patterns for thousands of files', () => {
    const many = Array.from({ length: 25_000 }, (_, index) => `/checkout/packages/p${index % 50}/test/case-${index}.test.ts`);

    expect(excluded(many).length).toBeLessThan(25);
  });
});
