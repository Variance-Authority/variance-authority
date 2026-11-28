import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHelp } from '../walk.js';
import { indexedCopy } from '../__fixtures__/indexed-copy.js';
import { searchIndexOf } from '../snapshot.js';
import { search } from './search.js';
import { candidateFileMap as placedFileMap } from './search-map.js';
const candidateFileMap: typeof placedFileMap = (root, membership, selector, expected = 'map-generation') => placedFileMap(root, membership, selector, expected);
import type { CandidateMap } from './search-map.js';
import { formatCandidateMap } from './search-map-format.js';
import { noCodeMap, STALE_MAP, unfoldedCodeMap } from './code-map-format.js';
import { sourceIndexPath } from '@variance-authority/sense';

const state = vi.hoisted(() => ({ current: true, present: true, pageCurrent: true, digest: 'map-generation', joined: false, rooted: false, unfolded: false }));
beforeEach(() => Object.assign(state, { current: true, present: true, pageCurrent: true, digest: 'map-generation', joined: false, rooted: false, unfolded: false }));

vi.mock('@variance-authority/sense', async (original) => ({
  ...await original<typeof import('@variance-authority/sense')>(),
  packageLayers: () => !state.present ? undefined : state.unfolded ? { indexDigest: state.digest, current: state.current, unmade: 'no manifest names a package' } : ({ indexDigest: state.digest, current: state.current, packages: [
    { package: 'alpha', directory: 'packages/alpha', layer: 1, takes: [], area: { id: '1', name: 'Foundation' } },
    { package: 'beta', directory: 'packages/beta', layer: 2, takes: ['alpha'], area: state.joined ? { id: '1', name: 'Foundation' } : { id: '2', name: 'Application' } },
    ...state.rooted ? [{ package: 'workspace', directory: '', layer: 3, takes: ['beta'], area: { id: '2', name: 'Application' } }] : [],
  ] }),
  codeMapPage: (_root: string, area?: string) => ({ index: 'index', answer: { current: state.pageCurrent, layers: 2, page: area === undefined || area === '1' || area === '2' ? {
    id: area ?? '', name: 'fixture', packages: 2, files: 6, low: 1, high: 2, alone: 0,
    list: area === '1' ? ['alpha'] : area === '2' ? ['beta'] : [],
    rows: area === undefined ? [
      { id: '1', name: 'Foundation', incoming: 1 }, { id: '2', name: 'Application', incoming: 0 },
    ] : [],
  } : undefined } }),
}));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/workspace');

describe('the complete search candidate-file map', () => {
  it('maps every matching file before the detail cap, with explicit membership drills', async () => {
    const indexed = await indexedCopy(ROOT);
    try {
      state.digest = searchIndexOf(indexed.help).generation!.indexDigest;
      const input = { query: 'e', limit: 1 };
      const complete = search.files!(indexed.help, input, { root: indexed.root });
      expect(complete.files.size).toBeGreaterThan(1);
      const text = search.run(indexed.help, { query: 'e', map: 'root' }, { root: indexed.root });
      expect(search.run(indexed.help, { ...input, map: 'root' }, { root: indexed.root })).toContain('the next 1: `docs_search` with `query` `e` and `map` `root` and `limit` `1` and `offset` `1`');
      expect(text).toContain('Candidate file map:');
      expect(text).toContain(`${complete.files.size} candidate files`);
      expect(text).toContain('Foundation');
      expect(text).toContain('Application');
      expect(text).toContain('map');
      expect([...search.files!(indexed.help, { ...input, map: 'root' }, { root: indexed.root }).files]).toEqual([...complete.files]);
    } finally { await indexed.remove(); }
  });
});

function membership(files: readonly string[]) {
  return { files: new Map(files.map((file, i) => [file, [i + 1]])), qualifications: new Map(files.map((file) => [file, 'near matches, not exact'])), unread: ['Unresolved source frontier.'] };
}

it('partitions every file, including unplaced candidates, with unchanged evidence and coordinates', () => {
  const set = membership(['packages/alpha/a.ts', 'packages/beta/b.ts', 'outside/orphan.ts']);
  const root = candidateFileMap(ROOT, set, 'root');
  expect(root.groups?.map(({ files }) => files)).toEqual([1, 1, 1]);
  expect(root.groups?.map(({ role }) => role)).toEqual(['foundation', 'application', undefined]);
  const recovered = root.groups!.flatMap(({ id }) => candidateFileMap(ROOT, set, id).groups!).flatMap(({ id }) => candidateFileMap(ROOT, set, id).entries!);
  expect(recovered.map(({ file, lines, qualification }) => [file, lines, qualification])).toEqual([...set.files].map(([file, lines]) => [file, lines, set.qualifications.get(file)]));
  expect(root.unread).toEqual(set.unread);
});

it('keeps large whole inventories drillable without selecting a first page of files', () => {
  const set = membership(Array.from({ length: 140 }, (_, i) => `packages/alpha/src/entry-${String(i).padStart(3, '0')}.ts`));
  const leaves: NonNullable<CandidateMap['entries']>[number][] = [];
  const visit = (selector: string) => {
    const page = candidateFileMap(ROOT, set, selector);
    expect((page.entries?.length ?? 0) + (page.groups ?? []).reduce((n, group) => n + group.files, 0)).toBe(page.selected);
    leaves.push(...page.entries ?? []);
    for (const group of page.groups ?? []) visit(group.id);
  };
  visit('package:alpha');
  expect(leaves.map(({ file, lines }) => [file, lines])).toEqual([...set.files]);
});

it('splits an overflowing package by the next directory, listing files directly in the common directory', () => {
  const set = membership([
    ...Array.from({ length: 70 }, (_, i) => `packages/alpha/src/apple/entry-${String(i).padStart(3, '0')}.ts`),
    ...Array.from({ length: 70 }, (_, i) => `packages/alpha/src/apricot/entry-${String(i).padStart(3, '0')}.ts`),
    'packages/alpha/src/index.ts',
  ]);
  const page = candidateFileMap(ROOT, set, 'package:alpha');
  expect(page.groups?.map(({ name, files }) => [name, files])).toEqual([['packages/alpha/src/apple/', 70], ['packages/alpha/src/apricot/', 70]]);
  expect(page.entries?.map(({ file }) => file)).toEqual(['packages/alpha/src/index.ts']);
  const apple = candidateFileMap(ROOT, set, page.groups![0]!.id);
  expect(apple.selected).toBe(70);
});

it('names a directory group for the deepest folder its files share, so no drill only descends', () => {
  const set = membership([...Array.from({ length: 140 }, (_, i) => `packages/alpha/src/a/b/c/entry-${String(i).padStart(3, '0')}.ts`), 'packages/alpha/src/z.ts']);
  expect(candidateFileMap(ROOT, set, 'package:alpha').groups?.map(({ name, files }) => [name, files])).toEqual([['packages/alpha/src/a/b/c/', 140]]);
});

it('keeps loose files reachable when they alone overflow beside a subdirectory, each file reached once', () => {
  const set = membership([...Array.from({ length: 300 }, (_, i) => `packages/alpha/src/component-${String(i).padStart(3, '0')}.ts`), 'packages/alpha/src/__tests__/x.test.ts']);
  const found: string[] = [];
  const visit = (selector: string) => {
    const page = candidateFileMap(ROOT, set, selector);
    expect(() => formatCandidateMap(page, (id) => id)).not.toThrow();
    found.push(...(page.entries ?? []).map(({ file }) => file));
    for (const group of page.groups ?? []) visit(group.id);
  };
  visit('package:alpha');
  expect(found.toSorted()).toEqual([...set.files.keys()].toSorted());
});

it('keeps terminal paths and complete Unicode code points when splitting prefixes', () => {
  const set = membership(['packages/alpha/😀.ts', 'packages/alpha/😁.ts', 'packages/alpha/a.ts', 'packages/alpha/a.tsx']);
  for (const [file] of set.files) set.files.set(file, Array.from({ length: 1200 }, (_, i) => i + 1));
  const found: string[] = [];
  const visit = (selector: string) => {
    const page = candidateFileMap(ROOT, set, selector);
    found.push(...(page.entries ?? []).map(({ file }) => file));
    for (const group of page.groups ?? []) visit(group.id);
  };
  visit('package:alpha');
  expect(new Set(found)).toEqual(new Set(set.files.keys()));
  expect(found.length).toBe(set.files.size);
});

it('says missing, unfolded and stale placement are unavailable as `ask orient` does, retaining the positive candidate count and source frontier', () => {
  const set = membership(['packages/alpha/a.ts']);
  const index = sourceIndexPath(ROOT);
  for (const [change, sentence] of [
    [{ present: false }, noCodeMap(index)],
    [{ unfolded: true }, unfoldedCodeMap(index, 'no manifest names a package')],
    [{ current: false }, STALE_MAP],
  ] as const) {
    Object.assign(state, change);
    const map = candidateFileMap(ROOT, set, 'root');
    expect(map.unavailable).toBe(sentence);
    expect(map.files).toBe(1);
    expect(map.groups).toBeUndefined();
    expect(map.unread).toEqual(set.unread);
    expect(formatCandidateMap(map, (id) => id)).toContain(sentence);
    expect(map.evidence).toEqual([{ qualification: "near matches, not exact", files: 1 }]);
    Object.assign(state, { present: true, current: true, unfolded: false });
  }
});

it('does not place an older search generation on the current map', () => {
  const map = candidateFileMap(ROOT, membership(['packages/alpha/a.ts']), 'root', 'older-generation');
  expect(map.unavailable).toContain('different source index');
  expect(map.files).toBe(1);
});

it('keeps a refused start point a refused text answer rather than trying to map its missing membership', () => {
  expect(search.run(readHelp(ROOT), { query: 'e', map: 'root', from: 'missing/' }, { root: ROOT })).toContain('no source tree was read');
});


it('refuses fabricated and malformed drills instead of expanding a different scope', () => {
  const set = membership(['packages/alpha/a.ts']);
  expect(() => candidateFileMap(undefined, set, 'root')).toThrow('checkout');
  expect(() => candidateFileMap(ROOT, set, 'area:%')).toThrow('not valid');
  expect(() => candidateFileMap(ROOT, set, 'something')).toThrow('drill id');
  expect(() => candidateFileMap(ROOT, set, 'area:9.9')).toThrow('no area');
  expect(() => candidateFileMap(ROOT, set, 'package:invented')).toThrow('no package');
  expect(() => candidateFileMap(ROOT, set, 'files:alpha:missing')).toThrow('no candidate file');
  state.pageCurrent = false;
  expect(candidateFileMap(ROOT, set, 'root').unavailable).toBe(STALE_MAP);
});

it('renders whole evidence-line inventories or a count, and refuses an oversized whole group listing', () => {
  const set = membership(['packages/alpha/a.ts']);
  set.files.set('packages/alpha/a.ts', Array.from({ length: 300 }, (_, i) => i + 1));
  const map = candidateFileMap(ROOT, set, 'package:alpha');
  const text = formatCandidateMap(map, (id) => id);
  expect(text).toContain('300 evidence lines');
  expect(text).toContain('near matches, not exact');
  expect(map.entries![0]!.lines).toHaveLength(300);
  const oversized = { ...map, entries: undefined, groups: [{ id: 'group', name: 'x'.repeat(10001), files: 1, layers: [], evidence: [] }] };
  expect(() => formatCandidateMap(oversized, (id) => id)).toThrow('No partial groups');
});

it('pages map groups by limit and offset, every group on exactly one page and the next page an emitted question', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `area:${i}`, name: `area ${i}`, files: 1, layers: [], evidence: [] }));
  const root: CandidateMap = { files: 120, selected: 120, selector: 'root', name: 'root', groups: many, unread: [], evidence: [] };
  const seen: string[] = [];
  let page = { offset: 0, limit: 50 };
  for (let pages = 0; pages < 5; pages++) {
    const text = formatCandidateMap(root, (id, offset) => `<${id}${offset === undefined ? '' : ` offset ${offset}`}>`, page);
    seen.push(...many.filter((group) => text.includes(`<${group.id}>`)).map((group) => group.id));
    const next = /the next \d+: <root offset (\d+)>/.exec(text)?.[1];
    if (next === undefined) break;
    page = { ...page, offset: Number(next) };
  }
  expect(seen).toEqual(many.map((group) => group.id));
  expect(() => candidateFileMap(ROOT, membership(['packages/alpha/a.ts']), 'root@1')).toThrow('drill id');
});

it('does not place a search reading without source-index identity', () => {
  const map = placedFileMap(ROOT, membership(['packages/alpha/a.ts']), 'root');
  expect(map.unavailable).toContain('identity');
  expect(map.files).toBe(1);
  expect(map.groups).toBeUndefined();
});

it('counts each dependency layer in descending order within an area', () => {
  state.joined = true;
  const map = candidateFileMap(ROOT, membership(['packages/alpha/a.ts', 'packages/beta/b.ts']), 'root');
  expect(map.groups![0]!.layers).toEqual([{ layer: 2, files: 1 }, { layer: 1, files: 1 }]);
});

it('places a file no nested package holds in the root package, which the map spells with an empty directory', () => {
  state.rooted = true;
  const set = membership(['tools/owners.mjs', 'packages/alpha/a.ts']);
  expect(candidateFileMap(ROOT, set, 'package:workspace')).toMatchObject({ selected: 1, entries: [{ file: 'tools/owners.mjs' }] });
  expect(candidateFileMap(ROOT, set, 'root').groups!.map(({ name, files }) => [name, files])).toEqual([['Foundation', 1], ['Application', 1]]);
});
