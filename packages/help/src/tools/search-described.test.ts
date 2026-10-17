import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { queryDependencyLexicon, refreshDependencyLexicon } from '../dependency-lexicon.js';
import { answerSearch, searchIndexOf } from './search.js';

/**
 * A job is described in words, not in an identifier. A workspace that declares
 * only `react` reaches it from "state management" through the words of its
 * names; a job no declared dependency describes is answered empty with the scope
 * it looked at; and the words are read from the installed package when the
 * lexicon is refreshed, never when the question is asked.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

it('reaches react from "state management", answers an undescribed job empty with its scope, and reads the words at refresh', async () => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react']);
  const help = readHelp(root);
  const said = (query: string): string => answerSearch(searchIndexOf(help), { query }, treeOf([], root), root);

  const state = said('state management');
  expect(state).toContain('1 package describes `state management`');
  expect(state).toContain('react @1.0.0 · dependency in package.json · not imported');
  expect(state).toContain('[holds: state]');
  expect(state).not.toContain('redux');

  const none = said('resize images');
  expect(none).toContain('Third-party names searched: 1 package under package.json.');
  expect(none).not.toContain('describe');

  const manifest = join(root, 'node_modules/react/package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'react', version: '1.0.0', description: 'Image resizing for components', types: 'index.d.ts' }));
  expect(said('resize images')).not.toContain('describes');
  await refreshDependencyLexicon(root);
  expect(said('resize images')).toContain('1 package describes `resize images`');
});

it('answers a description with the repository\'s own names first, and the packages that describe it after', async () => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
    'src/store.ts': '/** Keeps the state of one key. */\nexport function managedFor(key: string): string {\n  return key;\n}\n',
  });
  const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'state management' }, treeOf([], root), root);

  // Neither the phrase nor every word is in the name, so only the words held answer it.
  expect(said).toMatch(/managedFor .*\[holds: management, state\]/);
  expect(said.indexOf('managedFor')).toBeLessThan(said.indexOf('react @1.0.0'));
});

it('answers from a catalogue of the version before, names the described packages it cannot compare, and rebuilds it at refresh', async () => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react']);
  const catalogue = join(dirname(sourceIndexPath(root)), 'dependency-lexicon.bin');
  const bytes = readFileSync(catalogue);
  const header = bytes.subarray(0, 4 + bytes.readUInt32LE(0));
  const at = header.indexOf('"version":2');
  expect(at).toBeGreaterThan(-1);
  // Version 1 holds the same columns; only the stems of what a package says were cut another way.
  bytes.write('"version":1', at);
  writeFileSync(catalogue, bytes);
  const said = (): string => answerSearch(searchIndexOf(readHelp(root)), { query: 'state management' }, treeOf([], root), root);

  const older = said();
  expect(older).toContain('Third-party names searched: 1 package under package.json.');
  expect(older).not.toContain('package describes');
  expect(older).toContain('The dependency lexicon was written at version 1, whose stems this release does not compare, so no package was asked whether it describes `state management`; `variance index` rebuilds it.');

  await refreshDependencyLexicon(root);
  expect(said()).toContain('1 package describes `state management`');
  expect(queryDependencyLexicon(root, 'state management')).toMatchObject({ describedTotal: 1 });
  expect(queryDependencyLexicon(root, 'state management')).not.toHaveProperty('describedUnread');
});

describe('which names the described section holds, and in what order', () => {
  const ask = async (query: string): Promise<string> => {
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/store.ts': 'export function managedStateFor(key: string): string {\n  return key;\n}\n',
      'src/state.ts': '/** What a store manages for a key. */\nexport const stateOf = (key: string): string => key;\n',
      'src/cache.ts': 'export const cacheEntries: readonly string[] = [];\n',
      'src/policy.ts': 'export function evictionPolicyFor(size: number): number {\n  return size;\n}\n',
    });
    return answerSearch(searchIndexOf(readHelp(root)), { query }, treeOf([], root), root);
  };

  it('is absent when every word is a stopword, since there was nothing to describe', async () => {
    const said = await ask('of the');
    expect(said).not.toContain('hold at least half');
    expect(said).not.toContain('[holds:');
  });

  it('leaves out a name holding fewer than half the words', async () => {
    // Three stems, so two are needed: `evictionPolicyFor` holds two, `cacheEntries` one.
    const said = await ask('cache eviction policy');
    expect(said).toMatch(/evictionPolicyFor .*\[holds: eviction, policy\]/);
    expect(said).not.toContain('cacheEntries');
  });

  it('puts the name holding more of the words in its name first', async () => {
    // Both hold `state` and `management`: `managedStateFor` in its name, `stateOf` half in its doc.
    const said = await ask('state management policy');
    expect(said).toMatch(/stateOf .*\[holds: management, state\]/);
    expect(said.indexOf('managedStateFor')).toBeGreaterThan(-1);
    expect(said.indexOf('managedStateFor')).toBeLessThan(said.indexOf('stateOf'));
  });

  it('reads the words in a published doc too, after a name that holds one of them itself', async () => {
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'], dependencies: { react: '1.0.0' } }),
      'packages/kit/package.json': JSON.stringify({ name: 'kit', type: 'module', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } }),
      'packages/kit/tsconfig.json': JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }),
      'packages/kit/src/index.ts': '/** Management of each session and its state. */\nexport function journalOf(key: string): string {\n  return key;\n}\n',
      'src/store.ts': '/** Keeps the state of one key. */\nexport function managedFor(key: string): string {\n  return key;\n}\n',
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'state management' }, treeOf([], root), root);
    // `journalOf` holds neither word in its name; its published doc holds both.
    expect(said).toMatch(/journalOf .*\[holds: management, state\]/);
    expect(said).toMatch(/managedFor .*\[holds: management, state\]/);
    expect(said.indexOf('managedFor')).toBeLessThan(said.indexOf('journalOf'));
  });

  it('puts a name whose doc holds every word before one whose name holds half of them', async () => {
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/policy.ts': 'export function evictionPolicyFor(size: number): number {\n  return size;\n}\n',
      'src/sweep.ts': '/** The eviction policy a cache runs under. */\nexport const sweep = 1;\n',
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'cache eviction policy' }, treeOf([], root), root);
    expect(said).toMatch(/sweep .*\[holds: cache, eviction, policy\]/);
    expect(said).toMatch(/evictionPolicyFor .*\[holds: eviction, policy\]/);
    expect(said.indexOf('sweep')).toBeLessThan(said.indexOf('evictionPolicyFor'));
  });
});
