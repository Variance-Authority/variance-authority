import { describe, expect, it } from 'vitest';
import { selectionPlugins } from './rstest-selection.js';

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
