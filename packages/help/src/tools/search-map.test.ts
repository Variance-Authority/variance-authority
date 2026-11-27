import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHelp } from '../walk.js';
import { search } from './search.js';
import { candidateFileMap } from './search-map.js';
import type { CandidateMap } from './search-map.js';
import { formatCandidateMap } from './search-map-format.js';

const state = vi.hoisted(() => ({ current: true, present: true, pageCurrent: true }));
beforeEach(() => Object.assign(state, { current: true, present: true, pageCurrent: true }));

vi.mock('@variance-authority/sense', async (original) => ({
  ...await original<typeof import('@variance-authority/sense')>(),
  packageLayers: () => state.present ? ({ indexDigest: 'map-generation', current: state.current, packages: [
    { package: 'alpha', directory: 'packages/alpha', layer: 1, takes: [], area: { id: '1', name: 'Foundation' } },
    { package: 'beta', directory: 'packages/beta', layer: 2, takes: ['alpha'], area: { id: '2', name: 'Application' } },
  ] }) : undefined,
  codeMapPage: (_root: string, area?: string) => ({ index: 'index', answer: { current: state.pageCurrent, layers: 2, page: area === undefined || area === '1' || area === '2' ? {
    id: area ?? '', name: 'fixture', packages: 2, files: 6, low: 1, high: 2, alone: 0,
    list: area === '1' ? ['alpha'] : area === '2' ? ['beta'] : [],
    rows: area === undefined ? [
      { id: '1', name: 'Foundation', incoming: 1 }, { id: '2', name: 'Application', incoming: 0 },
    ] : [],
  } : undefined } }),
}));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/workspace');
const HELP = readHelp(ROOT);

describe('the complete search candidate-file map', () => {
  it('maps every matching file before the detail cap, with explicit membership drills', () => {
    const input = { query: 'e', limit: 1 };
    const complete = search.files!(HELP, input, { root: ROOT });
    expect(complete.files.size).toBeGreaterThan(1);
    const text = search.run(HELP, { ...input, map: 'root' }, { root: ROOT });
    expect(text).toContain('Candidate file map:');
    expect(text).toContain(`${complete.files.size} candidate files`);
    expect(text).toContain('Foundation');
    expect(text).toContain('Application');
    expect(text).toContain('map');
    expect([...search.files!(HELP, { ...input, map: 'root' }, { root: ROOT }).files]).toEqual([...complete.files]);
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

it('says missing and stale placement are unavailable, retaining the positive candidate count and source frontier', () => {
  const set = membership(['packages/alpha/a.ts']);
  for (const change of [{ present: false, current: true }, { present: true, current: false }]) {
    Object.assign(state, change);
    const map = candidateFileMap(ROOT, set, 'root');
    expect(map.unavailable).toBeDefined();
    expect(map.files).toBe(1);
    expect(map.groups).toBeUndefined();
    expect(map.unread).toEqual(set.unread);
    expect(map.evidence).toEqual([{ qualification: "near matches, not exact", files: 1 }]);
  }
  Object.assign(state, { present: true, current: true });
});

it('does not place an older search generation on the current map', () => {
  const map = candidateFileMap(ROOT, membership(['packages/alpha/a.ts']), 'root', 'older-generation');
  expect(map.unavailable).toContain('different source index');
  expect(map.files).toBe(1);
});

it('keeps a refused start point a refused text answer rather than trying to map its missing membership', () => {
  expect(search.run(HELP, { query: 'e', map: 'root', from: 'missing/' }, { root: ROOT })).toContain('no source tree was read');
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
  expect(candidateFileMap(ROOT, set, 'root').unavailable).toContain('earlier source index');
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
