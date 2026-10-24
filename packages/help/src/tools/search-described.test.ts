import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { declaredDescribedOf, describedWordsNative, sourceIndexPath } from '@variance-authority/sense';
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
  const at = header.indexOf('"version":3');
  expect(at).toBeGreaterThan(-1);
  // Version 1 holds the same columns; only the stems of what a package says were cut another way.
  bytes.write('"version":1', at);
  writeFileSync(catalogue, bytes);
  const said = (): string => answerSearch(searchIndexOf(readHelp(root)), { query: 'state management' }, treeOf([], root), root);

  const older = said();
  expect(older).toContain('Third-party names searched: 1 package under package.json.');
  expect(older).not.toContain('package describes');
  expect(older).toContain('The dependency lexicon was written at version 1, whose stems this release does not compare, so no package was asked whether it describes `state management`; `variance index` rebuilds it.');

  // A question by one exact name never reads the stems, so it answers whole and names no gap.
  const exact = queryDependencyLexicon(root, 'useState', undefined, true);
  expect(exact).toMatchObject({ total: 1 });
  expect(exact).not.toHaveProperty('describedUnread');

  await refreshDependencyLexicon(root);
  expect(said()).toContain('1 package describes `state management`');
  expect(queryDependencyLexicon(root, 'state management')).toMatchObject({ describedTotal: 1 });
  expect(queryDependencyLexicon(root, 'state management')).not.toHaveProperty('describedUnread');
});

it('answers described search from a catalogue of version 2, whose stems are this release\'s, and rebuilds it once at refresh', async () => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react']);
  const catalogue = join(dirname(sourceIndexPath(root)), 'dependency-lexicon.bin');
  const version = (): string => {
    const bytes = readFileSync(catalogue);
    return /"version":(\d+)/.exec(bytes.subarray(0, 4 + bytes.readUInt32LE(0)).toString())?.[1] ?? '';
  };
  const bytes = readFileSync(catalogue);
  const at = bytes.subarray(0, 4 + bytes.readUInt32LE(0)).indexOf('"version":3');
  expect(at).toBeGreaterThan(-1);
  // Version 2 cut its stems as this release does; only its owners were the root's workspaces.
  bytes.write('"version":2', at);
  writeFileSync(catalogue, bytes);

  const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'state management' }, treeOf([], root), root);
  expect(said).toContain('1 package describes `state management`');
  expect(said).not.toContain('whose stems this release does not compare');
  expect(queryDependencyLexicon(root, 'state management')).not.toHaveProperty('describedUnread');

  await refreshDependencyLexicon(root);
  expect(version()).toBe('3');
});

describe('which names the described section holds, and in what order', () => {
  const ask = async (query: string): Promise<string> => {
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/store.ts': 'export function managedStateFor(key: string): string {\n  return key;\n}\n',
      'src/state.ts': '/** What a store manages for a key. */\nexport const stateOf = (key: string): string => key;\n',
      'src/cache.ts': 'export const cacheEntries: readonly string[] = [];\n',
      'src/policy.ts': 'export function evictionPolicyFor(size: number): number {\n  return size;\n}\n',
      'src/tint.ts': 'export const tint = 1;\n\n/** Picks the palette for a key. */\nfunction pickFor(key: string): string {\n  return key;\n}\n',
    });
    return answerSearch(searchIndexOf(readHelp(root)), { query }, treeOf([], root), root);
  };

  it('is absent when every word is a stopword, since there was nothing to describe', async () => {
    const said = await ask('of the');
    expect(said).not.toMatch(/holds? words of/);
    expect(said).not.toContain('[holds:');
  });

  it('holds a name holding one of the words, after the name holding more of them', async () => {
    // Three stems: `evictionPolicyFor` holds two, `cacheEntries` one.
    const said = await ask('cache eviction policy');
    expect(said).toMatch(/evictionPolicyFor .*\[holds: eviction, policy\]/);
    expect(said).toMatch(/cacheEntries .*\[holds: cache\]/);
    expect(said.indexOf('evictionPolicyFor')).toBeLessThan(said.indexOf('cacheEntries'));
  });

  it('answers with the name holding one word of three, and does not call the answer empty', async () => {
    // No name holds two of `cache`, `chart` and `palette`; `cacheEntries` holds one.
    const said = await ask('cache chart palette');
    expect(said).toMatch(/cacheEntries .*\[holds: cache\]/);
    expect(said).toContain('No name in this repository, nor the doc of one, writes `cache chart palette` as typed. The nearest follow.');
    expect(said).not.toContain('Nothing in this repository');
  });

  it('says no name or a name\'s doc writes the words, not that no doc does, when only a file\'s opening doc writes them', async () => {
    // The substring reads names and their docs, and not the doc a file opens with.
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/frogs.ts': '/**\n * Where painted frogs dance.\n */\n\n/** One. */\nexport const pond = 1;\n',
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'painted frogs dance' }, treeOf([], root), root);
    expect(said).toMatch(/src\/frogs\.ts \[file\].*\[holds: dance, frogs, painted\]/u);
    expect(said).toContain('No name in this repository, nor the doc of one, writes `painted frogs dance` as typed. The nearest follow.');
    expect(said).not.toContain('No name or doc');
  });

  it('answers a file and a declaration no export binds by one word of three, as it answers an exported name', async () => {
    // Both are read from the source index, not the search index: `src/cache.ts`
    // by its own name, `pickFor` by its doc.
    const said = await ask('cache chart palette');
    expect(said).toMatch(/src\/cache\.ts \[file\].*\[holds: cache\]/);
    expect(said).toMatch(/pickFor .*\[holds: palette\]/);
  });

  describe('a name every word reaches loosely, though it holds one stem of three', () => {
    // `cache` is held as typed, `entriee` and `magazie` are each one character
    // off the name: one stem of three to the described reading, every word to
    // the loose one.
    const ask = async (competitors: number): Promise<string> => {
      const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
        'src/caches.ts': Array.from({ length: competitors }, (_, at) => `export const cacheAt${at} = ${at};\n`).join(''),
        'src/magazine.ts': 'export const cacheEntriesMagazine = 1;\n',
      });
      return answerSearch(searchIndexOf(readHelp(root)), { query: 'cache entriee magazie' }, treeOf([], root), root);
    };
    const LOOSE_SECTION = /(?:name matches|names match) loosely/u;

    it('is the loose section\'s, past more names holding the stem than the described section shows', async () => {
      const said = await ask(17);
      expect(said).toMatch(LOOSE_SECTION);
      expect(said.search(/^cacheEntriesMagazine /mu)).toBeGreaterThan(said.search(LOOSE_SECTION));
      expect(said).not.toMatch(/cacheEntriesMagazine .*\[holds:/u);
    });

    it('is the loose section\'s however few names sort before it, so the rows shown never decide which section tells it', async () => {
      const said = await ask(3);
      expect(said).toMatch(LOOSE_SECTION);
      expect(said.search(/^cacheEntriesMagazine /mu)).toBeGreaterThan(said.search(LOOSE_SECTION));
      expect(said).not.toMatch(/cacheEntriesMagazine .*\[holds:/u);
      expect(said).toMatch(/cacheAt0 .*\[holds: cache\]/u);
    });
  });

  it('leaves the loose section what it reaches that the described section does not, past any number of names both reach', async () => {
    // Every `cacheEntriesAt<n>` holds `cache`, half the stems, and is reached
    // loosely too; `kacheEntries` is reached loosely alone, each word one
    // character off.
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/caches.ts': Array.from({ length: 32 }, (_, at) => `export const cacheEntriesAt${at} = ${at};\n`).join(''),
      'src/kache.ts': 'export const kacheEntries = 1;\n',
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'cache entriee' }, treeOf([], root), root);
    expect(said).toMatch(/^1 more name matches loosely/mu);
    expect(said).toMatch(/^kacheEntries /mu);
  });

  it('keeps a name holding two stems of three where it was, rather than moving it below the names holding one', async () => {
    // `entriee` is one character off: `cacheMagazineEntries` holds `cache` and
    // `magazine` as typed, and every word loosely.
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/caches.ts': Array.from({ length: 3 }, (_, at) => `export const cacheAt${at} = ${at};\n`).join(''),
      'src/magazine.ts': 'export const cacheMagazineEntries = 1;\n',
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'cache entriee magazine' }, treeOf([], root), root);
    expect(said).toMatch(/cacheMagazineEntries .*\[holds: cache, magazine\]/u);
    expect(said.indexOf('cacheMagazineEntries')).toBeLessThan(said.indexOf('cacheAt0'));
    expect(said).not.toMatch(/(?:name matches|names match) loosely/u);
  });

  it('shows a name holding the one word nothing shown holds, past more names holding another word than the section shows', async () => {
    // Every `chartAt<n>` holds `chart` in its name, and forty swatches say
    // `palette` in their docs, so `chart` is rare enough among what was reached
    // that, held in a name, it outweighs `mermaid` held in `diagram`'s doc
    // alone: all sixteen sort before it.
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/charts.ts': Array.from({ length: 16 }, (_, at) => `export const chartAt${at} = ${at};\n`).join(''),
      'src/swatches.ts': Array.from({ length: 40 }, (_, at) => `/** One palette. */\nexport const swatch${at} = ${at};\n`).join(''),
      'src/diagram.ts': '/** Draws a mermaid diagram. */\nexport const diagram = 1;\n',
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'mermaid chart palette' }, treeOf([], root), root);
    expect(said).toMatch(/^diagram .*\[holds: mermaid\]/mu);
    expect(said.search(/^diagram /mu)).toBeGreaterThan(said.search(/^chartAt0 /mu));
    expect(said).toMatch(/more not shown/u);
    // Two `chartAt<n>` that sort before it are not shown, so the heading says why.
    expect(said).toContain("then the phrase its doc writes; a row holding each word is shown however it sorts.");
  });

  it('reads the phrase of every name level with the last row shown, so the one writing it is shown first', async () => {
    // All twenty docs hold the three words; only `keptAt19`'s writes `cache entries` adjacent.
    const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
      'src/kept.ts': Array.from({ length: 20 }, (_, at) =>
        `/** ${at === 19 ? 'Cache entries kept for each sweep.' : 'Sweeps the entries kept in a cache.'} */\nexport const keptAt${at} = ${at};\n`,
      ).join('\n'),
    });
    const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'cache entries sweep' }, treeOf([], root), root);
    expect(said.split('\n').find((line) => line.startsWith('keptAt'))).toMatch(/^keptAt19 /u);
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

it('hands back which of the asked words a declaration\'s name and a file\'s name hold, as positions into the question', async () => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], {
    'src/state-keeper.ts': '/** Keeps the management of one key. */\nfunction stateFor(key: string): string {\n  return key;\n}\nexport const kept = stateFor;\n',
  });
  const asked = describedWordsNative('state management');
  const state = asked.findIndex(([, word]) => word === 'state');
  const read = declaredDescribedOf(root, 'state management', asked.map(([stem]) => stem as string));

  expect(read?.names.find((one) => one.name === 'stateFor')).toMatchObject({ held: [0, 1], named: [state] });
  expect(read?.files.find((file) => file.at === 'src/state-keeper.ts')).toMatchObject({ named: [state] });
});
