// compass: variance-authority.report.agent-surface
import { nextPage, pageAt, paged, spellingOf, type Page, type Spelling } from '@variance-authority/mcp/tools';
import type { CandidateMap } from './search-map.js';

/** Groups one text page shows when no `limit` is said; every group is counted, and the next page is a question. */
export const MAP_GROUPS = 50;

/** The candidate-file map, with whole-group drills, its groups paged by `limit` and `offset`. */
export function formatCandidateMap(map: CandidateMap, drill: (id: string, offset?: number) => string, page: Page = { offset: 0, limit: MAP_GROUPS }, spell: Spelling = spellingOf(undefined)): string {
  const start = [`Candidate file map: ${map.files} candidate files; ${map.selected} in ${map.name}.`, 'Counts are files, not names. Layers are dependency layers; layer 1 takes nothing.'];
  const evidence = map.evidence.map(({ qualification, files }) => `${files} ${qualification ?? 'without an additional qualification'}`).join('; ');
  if (evidence !== '') start.push(`Source evidence across all candidates: ${evidence}.`);
  if (map.unavailable !== undefined) return [...start, map.unavailable, ...map.unread].join('\n');
  const all = map.groups ?? [];
  const groups = paged(all, page).map((group) => {
    const layers = group.layers.map(({ layer, files }) => `${layer}: ${files}`).join(', ');
    const evidence = group.evidence.flatMap(({ qualification, files }) => qualification === undefined ? [] : [`${files} ${qualification}`]).join('; ');
    return `${group.name}: ${group.files} files${group.role === undefined ? '' : `; ${group.role}`}${layers === '' ? '' : `; files by layer (top first) ${layers}`}${evidence === '' ? '' : `; ${evidence}`}\n  ${drill(group.id)}`;
  });
  const entries = (map.entries ?? []).map(({ file, lines, qualification }) => {
    const coordinates = lines.join(',');
    return `${file}${coordinates === '' ? '' : coordinates.length <= 128 ? `:${coordinates}` : ` (${lines.length} evidence lines; complete coordinates in JSON)`}${qualification === undefined ? '' : ` [${qualification}]`}`;
  });
  const lines = [...start, ...pageAt(page, all.length, spell), ...groups, ...nextPage(page, all.length, spell, (offset) => drill(map.selector, offset)), ...entries, ...map.unread.map((why) => `Coverage: ${why}`)];
  if (map.selector !== 'root') lines.push(`Other candidates remain on ${drill('root')}.`);
  if (lines.join('\n').length > 10000) throw new Error(`This page of map groups exceeds the text budget; ask a lower \`${spell.input('limit')}\` or a narrower emitted group. No partial groups were printed.`);
  return lines.join('\n');
}
