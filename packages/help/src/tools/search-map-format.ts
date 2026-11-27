// compass: variance-authority.report.agent-surface
import type { CandidateMap } from './search-map.js';

/** The candidate-file map, with whole-group drills; detailed name limits do not enter it. */
export function formatCandidateMap(map: CandidateMap, drill: (id: string) => string): string {
  const start = [`Candidate file map: ${map.files} candidate files; ${map.selected} in ${map.name}.`, 'Counts are files, not names. Layers are dependency layers; layer 1 takes nothing.'];
  const evidence = map.evidence.map(({ qualification, files }) => `${files} ${qualification ?? 'without an additional qualification'}`).join('; ');
  if (evidence !== '') start.push(`Source evidence across all candidates: ${evidence}.`);
  if (map.unavailable !== undefined) return [...start, map.unavailable, ...map.unread].join('\n');
  const groups = (map.groups ?? []).map((group) => {
    const layers = group.layers.map(({ layer, files }) => `${layer}: ${files}`).join(', ');
    const evidence = group.evidence.flatMap(({ qualification, files }) => qualification === undefined ? [] : [`${files} ${qualification}`]).join('; ');
    return `${group.name}: ${group.files} files${group.role === undefined ? '' : `; ${group.role}`}${layers === '' ? '' : `; files by layer (top first) ${layers}`}${evidence === '' ? '' : `; ${evidence}`}\n  ${drill(group.id)}`;
  });
  const entries = (map.entries ?? []).map(({ file, lines, qualification }) => {
    const coordinates = lines.join(',');
    return `${file}${coordinates === '' ? '' : coordinates.length <= 128 ? `:${coordinates}` : ` (${lines.length} evidence lines; complete coordinates in JSON)`}${qualification === undefined ? '' : ` [${qualification}]`}`;
  });
  const lines = [...start, ...groups, ...entries, ...map.unread.map((why) => `Coverage: ${why}`)];
  if (map.selector !== 'root') lines.push(`Other candidates remain on ${drill('root')}.`);
  if (lines.join('\n').length > 10000) throw new Error('The whole map group inventory exceeds the text budget; ask a narrower emitted group or the structured search API. No partial groups were printed.');
  return lines.join('\n');
}
