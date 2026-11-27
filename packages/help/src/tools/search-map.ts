// compass: variance-authority.report.agent-surface
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FileSet } from '@variance-authority/mcp/tools';
import { codeMapPage, packageLayers, packageOwner } from '@variance-authority/sense';

/** A complete partition's evidence classes, as the search producer qualified them. */
export interface CandidateEvidence { readonly qualification?: string; readonly files: number }
/** One drillable group of candidate files, never a page of names. */
export interface CandidateGroup {
  readonly id: string;
  readonly name: string;
  readonly files: number;
  readonly role?: 'foundation' | 'application';
  readonly layers: readonly { readonly layer: number; readonly files: number }[];
  readonly evidence: readonly CandidateEvidence[];
}
/** One candidate file, with every coordinate retained by the source question. */
export interface CandidateFile { readonly file: string; readonly lines: readonly number[]; readonly qualification?: string }
/** An explicit search view placed on the existing map; unavailable placement is not empty search. */
export interface CandidateMap {
  readonly files: number;
  readonly selected: number;
  readonly selector: string;
  /** The first group a text page shows, from a `<selector>@<n>` drill; JSON keeps every group. */
  readonly start?: number;
  readonly name: string;
  readonly groups?: readonly CandidateGroup[];
  readonly entries?: readonly CandidateFile[];
  readonly unread: readonly string[];
  readonly unavailable?: string;
  readonly evidence: readonly CandidateEvidence[];
}

type Placed = NonNullable<NonNullable<ReturnType<typeof packageLayers>>['packages']>[number];
type Page = NonNullable<NonNullable<ReturnType<typeof codeMapPage>['answer']>['page']>;
type Held = CandidateFile & { readonly placed?: Placed };
const id = (kind: string, ...parts: readonly string[]): string => [kind, ...parts.map(encodeURIComponent)].join(':');

function evidence(files: readonly Held[]): CandidateEvidence[] {
  const counts = new Map<string | undefined, number>();
  for (const file of files) counts.set(file.qualification, (counts.get(file.qualification) ?? 0) + 1);
  return [...counts].map(([qualification, files]) => ({ ...(qualification === undefined ? {} : { qualification }), files }));
}

function group(key: string, name: string, files: readonly Held[], incoming?: number): CandidateGroup {
  const layers = new Map<number, number>();
  for (const file of files) if (file.placed !== undefined) layers.set(file.placed.layer, (layers.get(file.placed.layer) ?? 0) + 1);
  return { id: key, name, files: files.length, ...(incoming === undefined ? {} : { role: incoming > 0 ? 'foundation' as const : 'application' as const }),
    layers: [...layers].sort(([a], [b]) => b - a).map(([layer, files]) => ({ layer, files })), evidence: evidence(files) };
}

function packages(files: readonly Held[]): CandidateGroup[] {
  const by = new Map<string, Held[]>();
  for (const file of files) {
    const name = file.placed?.package ?? '';
    if (!by.has(name)) by.set(name, []);
    by.get(name)!.push(file);
  }
  return [...by].sort(([a], [b]) => codeUnitOrder(a, b)).map(([name, held]) => group(id('package', name), name || 'No indexed package', held));
}

function areas(page: Page, files: readonly Held[]): CandidateGroup[] {
  const grouped = page.rows.map((row) => {
    const held = files.filter(({ placed }) => placed?.area?.id === row.id || placed?.area?.id.startsWith(`${row.id}.`));
    return group(id('area', row.id), row.name, held, row.incoming);
  }).filter((row) => row.files > 0);
  const outside = files.filter(({ placed }) => !page.rows.some((row) => placed?.area?.id === row.id || placed?.area?.id.startsWith(`${row.id}.`)));
  return page.id === '' && page.rows.length > 0
    ? [...grouped, ...(outside.length === 0 ? [] : [group('area:none', 'No code-map area', outside)])]
    : [...grouped, ...packages(outside)];
}

/** Split a large whole inventory by path prefixes, preserving the selected package. */
function filePage(name: string, files: readonly Held[]): Pick<CandidateMap, 'groups' | 'entries'> {
  if (files.length < 2 || JSON.stringify(files.map(({ placed: _placed, ...file }) => file)).length <= 4000) {
    return { entries: files.map(({ placed: _placed, ...file }) => file) };
  }
  let prefix = files[0]!.file;
  for (const file of files) while (!file.file.startsWith(prefix)) prefix = Array.from(prefix).slice(0, -1).join('');
  const by = new Map<string, Held[]>();
  const terminal = files.filter((file) => file.file === prefix);
  for (const file of files.filter((file) => file.file !== prefix)) {
    const next = prefix + Array.from(file.file.slice(prefix.length))[0]!;
    if (!by.has(next)) by.set(next, []);
    by.get(next)!.push(file);
  }
  return { groups: [...by].sort(([a], [b]) => codeUnitOrder(a, b)).map(([prefix, held]) => group(id('files', name, prefix), `${prefix}…`, held)), ...(terminal.length === 0 ? {} : { entries: terminal.map(({ placed: _placed, ...file }) => file) }) };
}

/** Place complete canonical membership on an already published code map, without reading source or changing matching. A `@<n>` suffix opens a text page from group n. */
export function candidateFileMap(root: string | undefined, membership: FileSet, selector: string, expectedIndexDigest?: string): CandidateMap {
  const [scope, page, ...rest] = selector.split('@');
  if (page === undefined) return placed(root, membership, selector, expectedIndexDigest);
  const map = placed(root, membership, scope!, expectedIndexDigest);
  const start = /^[1-9]\d*$/.test(page) && rest.length === 0 ? Number(page) : NaN;
  const groups = map.groups?.length ?? 0;
  if (map.unavailable !== undefined) return map;
  if (!(start < groups || start === groups && (map.entries?.length ?? 0) > 0)) throw new Error('The search map drill id is not valid.');
  return { ...map, start };
}

function placed(root: string | undefined, membership: FileSet, selector: string, expectedIndexDigest?: string): CandidateMap {
  if (root === undefined) throw new Error('The search map needs the checkout named by its host.');
  const candidates: CandidateFile[] = [...membership.files].map(([file, lines]) => {
    const qualification = membership.qualifications?.get(file);
    return { file, lines, ...(qualification === undefined ? {} : { qualification }) };
  });
  const base = { files: membership.files.size, selected: membership.files.size, selector, name: 'root', unread: membership.unread ?? [], evidence: evidence(candidates) };
  const layers = packageLayers(root);
  if (layers?.packages == null || !layers.current) return { ...base, unavailable: layers === undefined ? 'No code map is published.' : !layers.current ? 'The code map belongs to an earlier source index.' : layers.unmade ?? 'No packages were placed.' };
  if (expectedIndexDigest === undefined) return { ...base, unavailable: 'The search reading has no source-index identity to place on the code map.' };
  if (layers.indexDigest !== expectedIndexDigest) return { ...base, unavailable: 'The search reading and code map describe a different source index.' };
  const own = packageOwner(layers.packages.map((one) => one.directory));
  const directories = new Map(layers.packages.map((one) => [one.directory, one]));
  const held: Held[] = candidates.map((file) => {
    const placed = directories.get(own(file.file));
    return { ...file, ...(placed === undefined ? {} : { placed }) };
  });
  let parts: string[];
  try { parts = selector.split(':').map(decodeURIComponent); } catch { throw new Error('The search map drill id is not valid.'); }
  if (selector === 'root' || parts[0] === 'area' && parts.length === 2) {
    const area = selector === 'root' ? undefined : parts[1];
    const files = area === undefined ? held : held.filter(({ placed }) => area === 'none' ? placed?.area == null : placed?.area?.id === area || placed?.area?.id.startsWith(`${area}.`));
    if (area === 'none') return { ...base, selected: files.length, name: 'No code-map area', groups: packages(files) };
    const answer = codeMapPage(root, area).answer;
    if (answer?.page == null) throw new Error(`The code map has no area ${JSON.stringify(area)}.`);
    if (!answer.current) return { ...base, unavailable: 'The code map belongs to an earlier source index.' };
    return { ...base, selected: files.length, name: answer.page.name, groups: areas(answer.page, files) };
  }
  if (parts[0] !== 'package' && parts[0] !== 'files' || parts.length !== (parts[0] === 'package' ? 2 : 3)) throw new Error('Use root or a drill id printed by the search map.');
  const name = parts[1]!;
  if (name !== '' && !layers.packages.some((one) => one.package === name)) throw new Error(`The code map has no package ${JSON.stringify(name)}.`);
  const files = held.filter(({ placed, file }) => (placed?.package ?? '') === name && (parts[0] === 'package' || file.startsWith(parts[2]!)));
  if (parts[0] === 'files' && files.length === 0) throw new Error('That path prefix holds no candidate file in the selected package.');
  return { ...base, selected: files.length, name: parts[0] === 'files' ? `${name || 'No indexed package'}: ${parts[2]}` : name || 'No indexed package', ...filePage(name, files) };
}
