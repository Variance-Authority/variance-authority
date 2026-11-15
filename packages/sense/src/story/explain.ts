/**
 * A case explained from the record every run writes, with no story taped:
 * each statement of its body, the microseconds it took, and the regions it
 * was the first to run. The case index keeps one run of each case and charges
 * each region to the line that first reached it (`case-lines.ts`), so the
 * explanation has first visits only — the order and the repeats are a
 * story's.
 */

import { lineOf } from '../test-selection/case-lines.js';
import { shareOf } from '../test-selection/case-times.js';
import { newestRegions } from '../test-selection/case-readings.js';
import type { ReadRegion } from '../test-selection/readings-bytes.js';
import type { ExecutionTest } from '../test-selection/reverse.js';
import { namedCases, type OutcomeRegion } from './outcomes.js';
import { drawersOf } from './region-coordinates.js';

/** A line of the case: the regions it was the first to run, and its microseconds where the case was timed. Line 0 is before the body's first statement. */
export interface Statement {
  readonly line: number;
  readonly time?: number;
  /** Whole percent of the case, as {@link shareOf} reads it; absent where either time was not reported. */
  readonly share?: number;
  readonly regions: readonly OutcomeRegion[];
  /** Its regions folded into their declarations, as {@link Declaration} reads them. */
  readonly declarations: readonly Declaration[];
}

/** A case's statements as the record holds its newest run. */
export interface ExplainedCase {
  readonly file: string;
  readonly name: string;
  /** Whole milliseconds, absent when the runner reported none. */
  readonly duration?: number;
  /** Whether its statements were timed; untimed ones come by line. */
  readonly timed: boolean;
  /** Whether any region was charged to a line: false for a run recorded without cadence. */
  readonly lined: boolean;
  /** In the order first reached where timed, what ran before the first statement first. */
  readonly statements: readonly Statement[];
  /** The regions a hook's statement was the first to run, by the hook's line. */
  readonly hooks: readonly Statement[];
  /** Regions the case crossed with no line recorded. */
  readonly unlined: readonly OutcomeRegion[];
  /** The unlined regions folded into their declarations. */
  readonly unlinedDeclarations: readonly Declaration[];
}

/** A case explained, with the record it was read from and its id there. */
export interface RecordedExplanation extends ExplainedCase {
  readonly record: string;
  readonly id: string;
}

/** A case's statements from its times and the regions its newest run crossed, as {@link ExplainedCase} lays them out. */
export function statementsOf(
  test: Pick<ExecutionTest, 'file' | 'name' | 'duration' | 'times'>,
  regions: readonly ReadRegion[],
): ExplainedCase {
  const body = new Map<number, OutcomeRegion[]>();
  const hooks = new Map<number, OutcomeRegion[]>();
  const unlined: OutcomeRegion[] = [];
  const crossed: OutcomeRegion[] = [];
  for (const [file, name, path, startLine, endLine, value] of regions) {
    const region = { file, name, path, startLine, endLine };
    crossed.push(region);
    if (value === null) {
      unlined.push(region);
      continue;
    }
    const { line, ambient } = lineOf(value);
    const into = ambient ? hooks : body;
    into.set(line, [...into.get(line) ?? [], region]);
  }
  const times = test.times ?? [];
  const timedLines = new Set(times.map(({ line }) => line));
  const rest = [...body.keys()].filter((line) => !timedLines.has(line)).sort((left, right) => left - right);
  const before = rest[0] === 0 ? [rest.shift()!] : [];
  const fold = declarationsIn(crossed);
  const lined = (line: number, at: ReadonlyMap<number, OutcomeRegion[]>) => {
    const held = at.get(line) ?? [];
    return { regions: held, declarations: fold(held) };
  };
  const statements: Statement[] = [
    ...before.map((line) => ({ line, ...lined(line, body) })),
    ...times.map(({ line, time }) => {
      const share = shareOf(time, test.duration);
      return { line, time, ...(share === undefined ? {} : { share }), ...lined(line, body) };
    }),
    ...rest.map((line) => ({ line, ...lined(line, body) })),
  ];
  return {
    file: test.file,
    name: test.name,
    ...(test.duration === undefined ? {} : { duration: test.duration }),
    timed: test.times !== undefined,
    lined: body.size > 0 || hooks.size > 0,
    statements,
    hooks: [...hooks.keys()].sort((left, right) => left - right).map((line) => ({ line, ...lined(line, hooks) })),
    unlined,
    unlinedDeclarations: fold(unlined),
  };
}

/** A declaration a statement ran, by the region that draws it, and how many of its branches and loops ran besides. */
export interface Declaration {
  readonly region: OutcomeRegion;
  readonly arms: number;
}

/**
 * A fold of some of a case's regions into their declarations, each drawn as
 * {@link drawersOf} draws it over every region the case crossed, file by file
 * in the record's order: a statement reads by what it ran rather than by every
 * branch, and an arm a later statement ran stays with the declaration an
 * earlier one ran, so two declarations of one name in one file stay two.
 * Declarations come in the order each is first drawn.
 */
function declarationsIn(crossed: readonly OutcomeRegion[]): (regions: readonly OutcomeRegion[]) => Declaration[] {
  const byFile = new Map<string, OutcomeRegion[]>();
  for (const region of crossed) byFile.set(region.file, [...byFile.get(region.file) ?? [], region]);
  const drawer = new Map<OutcomeRegion, OutcomeRegion>();
  for (const inFile of byFile.values()) drawersOf(inFile).forEach((drawn, ordinal) => drawer.set(inFile[ordinal]!, inFile[drawn]!));
  return (regions) => {
    const declared = new Map<OutcomeRegion, { region: OutcomeRegion; arms: number }>();
    for (const region of regions) {
      const by = drawer.get(region) ?? region;
      const held = declared.get(by);
      if (held === undefined) declared.set(by, { region: by, arms: by === region ? 0 : 1 });
      else held.arms += 1;
    }
    return [...declared.values()];
  };
}

/** Every case {@link namedCases} finds, explained from its newest run. */
export function recordedStatements(root: string, name: string, file?: string): RecordedExplanation[] {
  return [...namedCases(root, name, file, ['index'])].map(({ record, opened, test }) => ({ ...statementsOf(test, newestRegions(opened, test.id) ?? []), record, id: test.id }));
}
