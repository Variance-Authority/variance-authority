import { describe, expect, it } from 'vitest';
import { commandLineGrep, grepOf } from './run-scope.js';

const grep = (argv: readonly string[]) => commandLineGrep('grep', ['--grep', '-g'], argv);

describe('the command line grep in a run scope', () => {
  it('keeps the pattern as typed, in each form Playwright takes it', () => {
    expect(grep(['test', '--grep', 'lists events'])).toEqual({ grep: 'lists events' });
    expect(grep(['test', '--grep=lists events'])).toEqual({ grep: 'lists events' });
    expect(grep(['test', '-g', '/lists/m'])).toEqual({ grep: '/lists/m' });
    expect(grep(['test', '-glists'])).toEqual({ grep: 'lists' });
  });

  it('reads the last one given, and none after `--`', () => {
    expect(grep(['test', '-g', 'one', '--grep', 'two'])).toEqual({ grep: 'two' });
    expect(grep(['test', '--', '--grep', 'theirs'])).toEqual({});
  });

  it('tells the invert flag from the grep', () => {
    expect(grep(['test', '-G', 'lists'])).toEqual({});
    expect(commandLineGrep('grepInvert', ['--grep-invert', '-G'], ['test', '-G', 'lists'])).toEqual({ grepInvert: 'lists' });
  });
});

describe('a project grep in a run scope', () => {
  it('is the pattern Playwright compiled, flags and all, and absent where it lets everything through', () => {
    expect(grepOf('grep', /lists/gi)).toEqual({ grep: '/lists/gi' });
    expect(grepOf('grep', [/one/, /two/])).toEqual({ grep: '/one/ | /two/' });
    expect(grepOf('grep', /.*/)).toEqual({});
  });
});
