import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readNamedTree } from '@variance-authority/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askSource, type SourceRequest } from './ask.js';

/**
 * `variance ask discover` reads its names from the checkout, through the
 * source index. An ask that finds every file already in the index must still
 * have their names: a file the index serves is not a file that declares
 * nothing. The fixture is committed, so the scan knows every file's digest
 * and the second ask is served from the index rather than parsed again.
 *
 * Asked as `variance ask` asks it, from the checkout's root and with the flags
 * as the command line carries them, so the question reaches the reading that
 * holds names and every set reaches the tool.
 */

const cwd = process.cwd();
let root: string;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ask-discover-'));
  write('package.json', '{"name":"ask-discover-fixture","private":true}\n');
  write('src/Wallet.ts', "import { selectBalance } from './store';\nexport const balance = selectBalance;\n");
  write('src/store/index.ts', "import { selectBalance } from './selectors';\nexport { selectBalance };\n");
  write('src/store/selectors.ts', 'export const selectBalance = (state: { balance: number }) => state.balance;\n');
  write('src/old/selectors.ts', 'export const selectBalance = () => 0;\n');
  write('src/Nav.ts', "import { useTheme } from './theme';\nexport const nav = useTheme;\n");
  write('src/theme.ts', "const ThemeContext = { theme: 'light' };\nexport const useTheme = () => ThemeContext;\n");
  // `greet` reaches its users through two barrels; `wave` passes through the same ones.
  write('src/lib/greet.ts', "export const greet = () => 'hi';\nexport const wave = () => 'o/';\n");
  write('src/lib/index.ts', "export { greet, wave } from './greet';\n");
  write('src/lib/all.ts', "export * from './index';\n");
  write('src/Hello.ts', "import { greet } from './lib';\nexport const hello = greet;\n");
  write('src/Deep.ts', "import { greet } from './lib/all';\nexport const deep = greet;\n");
  write('src/Waver.ts', "import { wave } from './lib';\nexport const waver = wave;\n");
  write('src/Page.ts', "import { hello } from './Hello';\nexport const page = hello;\n");
  const commit = (...args: string[]): void => void execFileSync('git', ['-C', root, ...args]);
  commit('init', '--quiet');
  commit('add', '.');
  commit('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'fixture');
  process.chdir(root);
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

const ask = (flags: Omit<SourceRequest, 'question'>): Promise<string> => askSource({ question: 'discover', ...flags });
const declaresBalance = (): Promise<string> => ask({ declares: '^selectBalance$', from: 'src/Wallet.ts' });

describe('ask discover over a checkout', () => {
  it('finds the declaration a file can reach, among every file declaring the name, past the barrel that re-exports it', async () => {
    const text = await declaresBalance();
    expect(text).toContain('2 files declaring a name matching /^selectBalance$/i');
    expect(text).toContain('src/store/selectors.ts:1  declares selectBalance');
    expect(text).not.toContain('src/old/selectors.ts');
    expect(text).not.toContain('src/store/index.ts');
  });

  it('takes out the files an `--except-` set names', async () => {
    const text = await ask({ declares: '^selectBalance$', exceptPath: '/store/' });
    expect(text).toContain('src/old/selectors.ts:1  declares selectBalance');
    expect(text).not.toContain('src/store/selectors.ts');
  });

  it('finds who imports a name out of a file through the barrel that passes it on, as `uses` does', async () => {
    const text = await ask({ imports: 'src/store/selectors.ts#selectBalance' });
    expect(text).toContain('2 files importing `selectBalance` from `src/store/selectors.ts`, through 1 file that passes it on');
    expect(text).toContain('src/Wallet.ts:1  imports selectBalance from ./store');
    expect(text).toContain('src/store/index.ts:1  imports selectBalance from ./selectors');
  });

  it('finds what rests on a name out of a file, through the barrels that pass it on, and not what imports another name through them', async () => {
    const text = await ask({ to: 'src/lib/greet.ts#greet' });
    expect(text).toContain('4 files reaching `greet` from `src/lib/greet.ts`, through 2 files that pass it on');
    expect(text).toContain('src/Hello.ts:1  imports greet from ./lib');
    expect(text).toContain('src/Deep.ts:1  imports greet from ./lib/all');
    expect(text).toContain('2 imports to src/lib/greet.ts#greet: src/Page.ts → src/Hello.ts:1 imports greet from ./lib');
    expect(text).not.toContain('src/Waver.ts');
    expect(text).not.toContain('src/lib/index.ts');
  });

  it('crosses paths alone, with no names to read', async () => {
    const text = await ask({ from: 'src/Wallet.ts', path: '^src/store/' });
    expect(text).toContain('2 files in all of them');
    expect(text).toContain('src/store/selectors.ts');
    expect(text).not.toContain('src/old/selectors.ts');
  });

  it('reads the names only for a question with a set read off them', async () => {
    expect((await readNamedTree(root, { from: ['src/Wallet.ts'], path: '^src/store/' })).names).toBeUndefined();
    expect((await readNamedTree(root, { declares: '^selectBalance$' })).names?.get('src/old/selectors.ts')?.declared).toEqual([{ name: 'selectBalance', line: 1 }]);
  });

  it('finds a declaration the file does not export, which is where a context is made', async () => {
    const text = await ask({ declares: '^ThemeContext$', from: 'src/Nav.ts' });
    expect(text).toContain('src/theme.ts:1  declares ThemeContext');
  });

  it('answers the same when every file is read back from the source index', async () => {
    rmSync(sourceIndexPath(root), { force: true });
    const parsed = await declaresBalance();
    expect(existsSync(sourceIndexPath(root))).toBe(true);
    const held = await declaresBalance();
    expect(held).toContain('src/store/selectors.ts:1  declares selectBalance');
    expect(held).toBe(parsed);
  });
});
