import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directCallLine } from './direct-call.js';

/**
 * The environment each launcher leaves, as measured: Yarn 4 and pnpm running a
 * bin, `npm exec`, and a package script.
 */
const YARN = { npm_config_user_agent: 'yarn/4.18.0 npm/? node/v24.18.0 darwin arm64' };
const PNPM = { npm_config_user_agent: 'pnpm/11.9.0 npm/? node/v24.18.0 darwin arm64', npm_command: 'exec' };
const NPM_EXEC = { npm_config_user_agent: 'npm/11.16.0 node/v24.18.0 darwin arm64 workspaces/false', npm_command: 'exec', npm_lifecycle_event: 'npx', npm_lifecycle_script: '"variance"' };
const SCRIPT = { npm_config_user_agent: 'yarn/4.18.0 npm/? node/v24.18.0 darwin arm64', npm_lifecycle_event: 'check' };

let root: string;
let self: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-direct-call-')));
  self = join(root, 'node_modules', '@variance-authority', 'cli', 'dist', 'bin.js');
  mkdirSync(join(self, '..'), { recursive: true });
  writeFileSync(self, '');
  mkdirSync(join(root, 'node_modules', '.bin'));
  symlinkSync('../@variance-authority/cli/dist/bin.js', join(root, 'node_modules', '.bin', 'variance'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the faster direct call', () => {
  it('names the installed binary, with the same arguments, when yarn launched it', () => {
    const line = directCallLine(['ask', 'symbol', '--name', 'readFlags'], YARN, root, self);
    expect(line).toBe('\nThe same command answers faster without yarn: node_modules/.bin/variance ask symbol --name readFlags\n');
  });

  it('names it for pnpm and for `npm exec` too', () => {
    expect(directCallLine(['--version'], PNPM, root, self)).toContain('without pnpm: node_modules/.bin/variance --version');
    expect(directCallLine(['--version'], NPM_EXEC, root, self)).toContain('without npm: node_modules/.bin/variance --version');
  });

  it('quotes an argument the shell would split', () => {
    expect(directCallLine(['ask', 'search', '--query', "two words, it's"], YARN, root, self)).toContain(
      `node_modules/.bin/variance ask search --query 'two words, it'\\''s'`,
    );
  });

  it('finds the binary of the checkout from a directory inside it', () => {
    const inside = join(root, 'packages', 'app');
    mkdirSync(inside, { recursive: true });
    expect(directCallLine(['index'], YARN, inside, self)).toContain(`without yarn: ${join(root, 'node_modules', '.bin', 'variance')} index`);
  });

  it('says nothing when no package manager launched it', () => {
    expect(directCallLine(['index'], {}, root, self)).toBe('');
  });

  it('says nothing inside a package script, whose author chose the call', () => {
    expect(directCallLine(['index'], SCRIPT, root, self)).toBe('');
  });

  it('says nothing when there is no binary to call, as under Plug’n’Play', () => {
    rmSync(join(root, 'node_modules', '.bin'), { recursive: true });
    expect(directCallLine(['index'], YARN, root, self)).toBe('');
  });

  it('says nothing when the nearest binary is another file than this program', () => {
    expect(directCallLine(['index'], YARN, root, join(root, 'elsewhere.js'))).toBe('');
  });
});
