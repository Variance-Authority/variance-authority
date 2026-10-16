import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directCallLine } from './direct-call.js';

/**
 * The environment a package manager leaves. Every one sets a user agent, whose
 * name is never read. A script sets the lifecycle event to the script's name;
 * other launches leave it unset or set it to a name no script declares.
 */
const LAUNCHED = { npm_config_user_agent: 'pm/1.0.0 npm/? node/v24.18.0 darwin arm64' };
const UNDECLARED = { ...LAUNCHED, npm_lifecycle_event: 'exec' };
const SCRIPT = { ...LAUNCHED, npm_lifecycle_event: 'check' };

let root: string;
let self: string;
let binary: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-direct-call-')));
  self = join(root, 'node_modules', '@variance-authority', 'cli', 'dist', 'bin.js');
  mkdirSync(join(self, '..'), { recursive: true });
  writeFileSync(self, '');
  mkdirSync(join(root, 'node_modules', '.bin'));
  binary = join(root, 'node_modules', '.bin', 'variance');
  symlinkSync('../@variance-authority/cli/dist/bin.js', binary);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the faster direct call', () => {
  it('names the installed binary by its full path, with the same arguments, when a package manager launched it', () => {
    const line = directCallLine(['ask', 'symbol', '--name', 'readFlags'], LAUNCHED, root, self);
    expect(line).toBe(`\nvariance: the same command answers faster: ${binary} ask symbol --name readFlags\n`);
  });

  it('names it when the lifecycle event is a name no script declares', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'variance index' } }));
    expect(directCallLine(['--version'], UNDECLARED, root, self)).toContain(`faster: ${binary} --version`);
  });

  it('quotes a binary path the shell would split', () => {
    const spaced = realpathSync(mkdtempSync(join(tmpdir(), 'va direct call ')));
    try {
      mkdirSync(join(spaced, 'node_modules', '.bin'), { recursive: true });
      symlinkSync(self, join(spaced, 'node_modules', '.bin', 'variance'));
      const inside = join(spaced, 'app');
      mkdirSync(inside);
      expect(directCallLine(['index'], LAUNCHED, inside, self)).toContain(`faster: '${join(spaced, 'node_modules', '.bin', 'variance')}' index`);
    } finally {
      rmSync(spaced, { recursive: true, force: true });
    }
  });

  it('quotes an argument the shell would split', () => {
    expect(directCallLine(['ask', 'search', '--query', "two words, it's"], LAUNCHED, root, self)).toContain(
      `${binary} ask search --query 'two words, it'\\''s'`,
    );
  });

  it('finds the binary of the checkout from a directory inside it', () => {
    const inside = join(root, 'packages', 'app');
    mkdirSync(inside, { recursive: true });
    expect(directCallLine(['index'], { ...LAUNCHED, INIT_CWD: inside }, inside, self)).toContain(`faster: ${binary} index`);
  });

  it('says nothing when it runs in another directory than the command was typed in', () => {
    // Typed there, the same arguments would name other files: `src/a.ts` from `packages/app` is not the root's.
    const typedIn = join(root, 'packages', 'app');
    mkdirSync(typedIn, { recursive: true });
    expect(directCallLine(['covering', '--file', 'src/a.ts'], { ...UNDECLARED, INIT_CWD: typedIn }, root, self)).toBe('');
  });

  it('names the full path when it runs where the command was typed', () => {
    expect(directCallLine(['covering', '--file', 'src/a.ts'], { ...UNDECLARED, INIT_CWD: root }, root, self)).toBe(
      `\nvariance: the same command answers faster: ${binary} covering --file src/a.ts\n`,
    );
  });

  it('says nothing when no package manager launched it', () => {
    expect(directCallLine(['index'], {}, root, self)).toBe('');
  });

  it('says nothing inside a package script, whose author chose the call', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'variance index' } }));
    expect(directCallLine(['index'], SCRIPT, root, self)).toBe('');
  });

  it('reads the script from the nearest package, as a workspace runs its own', () => {
    const app = join(root, 'packages', 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    writeFileSync(join(app, 'package.json'), JSON.stringify({ scripts: { check: 'variance index' } }));
    expect(directCallLine(['index'], SCRIPT, app, self)).toBe('');
  });

  it('says nothing when there is no binary to call, as under Plug’n’Play', () => {
    rmSync(join(root, 'node_modules', '.bin'), { recursive: true });
    expect(directCallLine(['index'], LAUNCHED, root, self)).toBe('');
  });

  it('says nothing when the nearest binary is another file than this program', () => {
    const elsewhere = join(root, 'elsewhere.js');
    writeFileSync(elsewhere, '');
    expect(directCallLine(['index'], LAUNCHED, root, elsewhere)).toBe('');
  });

  it('says nothing when the binary is a wrapper script, as some package managers and Windows write it', () => {
    // A wrapper is not this program's file, whatever it runs.
    rmSync(join(root, 'node_modules', '.bin', 'variance'));
    writeFileSync(join(root, 'node_modules', '.bin', 'variance'), `#!/bin/sh\nexec node "${self}" "$@"\n`);
    expect(directCallLine(['index'], LAUNCHED, root, self)).toBe('');
  });
});
