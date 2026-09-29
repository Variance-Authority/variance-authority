/**
 * The `docs_journey_map` answer as text: how many tests entered the file and
 * how many the task kept, the paths through each function of the file, then the
 * code beyond it — the spine first, nearest first, then the branches.
 *
 * Every row is a file, a line and a count of tests; nothing here is read from
 * source text. A denominator is stated wherever a share was taken, and an
 * absent part is left out rather than printed as none.
 */

// compass: variance-authority.report.agent-surface

import type { JourneyMap, JourneyMapFunction } from '@variance-authority/sense';

/** Rows listed per part when the map is longer. */
const ROWS = 12;

/** The map as text. */
export function formatJourneyMap(map: JourneyMap, terms: readonly string[]): string {
  const task = terms.length === 0 ? 'every test that entered it' : `tests named for ${terms.map((t) => `\`${t}\``).join(' or ')}`;
  const lines = [
    `${map.file}: ${map.entered} of ${map.suite} recorded tests entered it; ${map.kept} kept (${task}).`,
  ];
  if (map.kept === 0) return lines.join('\n');
  lines.push('', 'Kept tests, smallest journey first:');
  for (const test of map.tests.slice(0, ROWS)) {
    lines.push(`  ${test.file}  ${test.name}  (${test.blocks} regions${alike(test.alike)})`);
  }
  more(lines, map.tests.length);
  lines.push('', `Inside ${map.file}, by function:`);
  for (const held of map.functions) lines.push(...within(held, map.kept));
  if (map.structure > 0) {
    lines.push('', `${map.structure} functions beyond the file are structure: the kept tests and at least half of the ${map.suite} recorded tests enter them, so they are not drawn.`);
  }
  if (map.spine.length > 0) {
    lines.push('', `Beyond the file, entered by most of the ${map.kept} kept tests, nearest first:`);
    for (const place of map.spine.slice(0, ROWS)) {
      lines.push(`  ${place.function.file}:${place.function.line}  ${place.function.name}  ${place.cases} ${tests(place.cases)}; nearest ${place.nearest.name}`);
    }
    more(lines, map.spine.length);
  }
  if (map.branches.length > 0) {
    lines.push('', 'Beyond the file, entered by only some of the kept tests, most tests first:');
    for (const branch of map.branches.slice(0, ROWS)) {
      const shown = branch.places.slice(0, 3).map((p) => `${p.file}:${p.line} ${p.name}`).join(', ');
      const rest = branch.places.length > 3 ? ` and ${branch.places.length - 3} more` : '';
      lines.push(`  ${branch.cases} ${tests(branch.cases)}, smallest ${branch.smallest.name}: ${shown}${rest}`);
    }
    more(lines, map.branches.length);
  }
  return lines.join('\n');
}

/** A function with one way through is a line; one with several is that line and each way, the passage collapsed to a row. */
function within(held: JourneyMapFunction, kept: number): string[] {
  const where = `${held.function.file}:${held.function.line}  ${held.function.name}: ${held.cases} of ${kept} kept ${tests(held.cases, kept)}`;
  if (held.paths.length <= 1) return [where];
  const lines = [`${where}, by ${held.paths.length} paths`];
  for (const path of held.paths.slice(0, ROWS)) {
    const entered = path.entered.slice(0, 3).map((b) => `${b.kind} at line ${b.line}`).join(', ');
    lines.push(`    ${path.passage ? 'passage' : 'branch '}  ${path.cases} ${tests(path.cases)}  ${entered || 'no inner region'}  smallest ${path.smallest.name}`);
  }
  more(lines, held.paths.length);
  return lines;
}

function tests(count: number, kept?: number): string {
  return count === 1 && kept === undefined ? 'test' : 'tests';
}

function alike(others: number | null | undefined): string {
  return others === undefined || others === null || others === 0 ? '' : `, ${others} ${others === 1 ? 'other' : 'others'} the same`;
}

function more(lines: string[], total: number): void {
  if (total > ROWS) lines.push(`  and ${total - ROWS} more`);
}
