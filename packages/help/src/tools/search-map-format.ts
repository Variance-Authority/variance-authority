// compass: variance-authority.report.agent-surface
import { nextPage, pageAt, paged, spellingOf, type Page, type Spelling } from '@variance-authority/mcp/tools';
import type { CandidateMap } from './search-map.js';

/** The most groups one text page shows when no `limit` is said; every group is counted, and the next page is a question. */
export const MAP_GROUPS = 50;

/** The characters one text page of the map holds. */
const MAP_TEXT = 10000;

/**
 * The candidate-file map, with whole-group drills, its groups paged by `limit`
 * and `offset`. With no `limit` said, the page holds as many groups as fit the
 * text budget, at most `MAP_GROUPS`, and the next page's question starts after them.
 * Files listed beside the groups print on the first page alone, so each is read once.
 * An unavailable map has no groups to page, and is said whole.
 */
export function formatCandidateMap(map: CandidateMap, drill: (id: string, offset?: number) => string, page: Page | { readonly offset: number } = { offset: 0 }, spell: Spelling = spellingOf(undefined)): string {
  if (map.unavailable !== undefined) return mapLines(map, drill, { offset: page.offset, limit: MAP_GROUPS }, spell, false).join('\n');
  const said = 'limit' in page;
  for (let limit = said ? page.limit : MAP_GROUPS; ; limit -= 1) {
    const text = mapLines(map, drill, { offset: page.offset, limit }, spell, !said).join('\n');
    if (text.length <= MAP_TEXT) return text;
    if (said || limit === 1) throw new Error(`This page of map groups exceeds the text budget; ask ${said ? `a lower \`${spell.input('limit')}\` or ` : ''}a narrower emitted group. No partial groups were printed.`);
  }
}

function mapLines(map: CandidateMap, drill: (id: string, offset?: number) => string, page: Page, spell: Spelling, fitted: boolean): string[] {
  const start = [`Candidate file map: ${map.files} candidate files; ${map.selected} in ${map.name}.`, 'Counts are files, not names. Layers are dependency layers; layer 1 takes nothing.'];
  const evidence = map.evidence.map(({ qualification, files }) => `${files} ${qualification ?? 'without an additional qualification'}`).join('; ');
  if (evidence !== '') start.push(`Source evidence across all candidates: ${evidence}.`);
  if (map.unavailable !== undefined) return [...start, map.unavailable, ...map.unread];
  const all = map.groups ?? [];
  const groups = paged(all, page).map((group) => {
    const layers = group.layers.map(({ layer, files }) => `${layer}: ${files}`).join(', ');
    const evidence = group.evidence.flatMap(({ qualification, files }) => qualification === undefined ? [] : [`${files} ${qualification}`]).join('; ');
    return `${group.name}: ${group.files} files${group.role === undefined ? '' : `; ${group.role}`}${layers === '' ? '' : `; files by layer (top first) ${layers}`}${evidence === '' ? '' : `; ${evidence}`}\n  ${drill(group.id)}`;
  });
  const entries = (page.offset === 0 ? map.entries ?? [] : []).map(({ file, lines, qualification }) => {
    const coordinates = lines.join(',');
    return `${file}${coordinates === '' ? '' : coordinates.length <= 128 ? `:${coordinates}` : ` (${lines.length} evidence lines; complete coordinates in JSON)`}${qualification === undefined ? '' : ` [${qualification}]`}`;
  });
  const lines = [...start, ...pageAt(page, all.length, spell), ...groups, ...nextPage(page, all.length, spell, (offset) => drill(map.selector, offset), fitted), ...entries, ...map.unread.map((why) => `Coverage: ${why}`)];
  if (map.selector !== 'root') lines.push(`Other candidates remain on ${drill('root')}.`);
  return lines;
}
