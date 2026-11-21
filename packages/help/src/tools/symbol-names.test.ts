import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Help } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readHelp } from '../walk.js';
import { FoundNothing } from './find.js';
import { symbol } from './symbol.js';

/**
 * `symbol` asked about several names, said as a comma list: each is answered
 * as it is answered alone, in the order given, and a name nothing declares is
 * said in its place while the others still answer. A comma is part of no name.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
let root = '';
let help: Help;

beforeEach(async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-names-cache-'));
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-symbol-names-')));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'merge', private: true, workspaces: ['packages/*'] }),
    'packages/merge/package.json': JSON.stringify({ name: '@x/merge', exports: { '.': './src/index.ts' } }),
    'packages/merge/src/index.ts': "export { localToRemote } from './local';\nexport { baseToLocal } from './base';\n",
    'packages/merge/src/local.ts': '/** Maps a local line to the remote one. */\nexport function localToRemote(line: number): number {\n  return line;\n}\n',
    'packages/merge/src/base.ts': '/** Maps a base line to the local one. */\nexport function baseToLocal(line: number): number {\n  return line;\n}\n',
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  help = readHelp(root);
});

afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

/** What `symbol` says of one name: its answer, or the refusal it throws when nothing declares it. */
function alone(name: string): string {
  try {
    return symbol.run(help, { name }, { root }) as string;
  } catch (refusal) {
    if (refusal instanceof FoundNothing) return refusal.message;
    throw refusal;
  }
}

it('answers each of two declared names as it answers one, in the order given', () => {
  const answer = symbol.run(help, { name: 'baseToLocal,localToRemote' }, { root });
  expect(answer).toBe(`${alone('baseToLocal')}\n\n${alone('localToRemote')}`);
  expect(alone('baseToLocal')).toContain('declared at packages/merge/src/base.ts:2');
});

it('says a name nothing declares in its place, and still answers the others', () => {
  const answer = symbol.run(help, { name: 'localToRemote, baseToRemote' }, { root });
  expect(answer).toBe(`${alone('localToRemote')}\n\n${alone('baseToRemote')}`);
  expect(alone('baseToRemote')).toContain('No file in this workspace declares `baseToRemote`');
});

it('refuses a list whose names are all undeclared as it refuses one, with each said', () => {
  expect(() => symbol.run(help, { name: 'baseToRemote,remoteCompare' }, { root })).toThrow(FoundNothing);
  expect(() => symbol.run(help, { name: 'baseToRemote,remoteCompare' }, { root })).toThrow(`${alone('baseToRemote')}\n\n${alone('remoteCompare')}`);
});

it('refuses a list with an empty name in it', () => {
  expect(() => symbol.run(help, { name: 'localToRemote,,baseToLocal' }, { root })).toThrow('`localToRemote,,baseToLocal` has an empty name between its commas');
});

it('gives the files that declare any of the names, leaving out the one nothing declares', () => {
  const files = symbol.files?.(help, { name: 'localToRemote,baseToRemote,baseToLocal' }, { root });
  expect(files === undefined ? [] : [...files.files.keys()].sort()).toEqual(['packages/merge/src/base.ts', 'packages/merge/src/local.ts']);
});
