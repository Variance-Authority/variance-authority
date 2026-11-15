/**
 * A case explained from the record every run writes, with no story taped:
 * each statement of its body, the microseconds it took, and the regions it
 * was the first to run. The case index keeps one run of each case and charges
 * each region to the line that first reached it (`case-lines.ts`), so the
 * explanation has first visits only — the order and the repeats are a
 * story's.
 */

import { askCoverageFile } from '../test-selection/coverage-file.js';
import { lineOf } from '../test-selection/case-lines.js';
import { shareOf } from '../test-selection/case-times.js';
import { newestRegions } from '../test-selection/case-readings.js';
import type { ReadRegion } from '../test-selection/readings-bytes.js';
import type { ExecutionTest } from '../test-selection/reverse.js';
import { namedCases, type OutcomeRegion } from './outcomes.js';

/** A line of the case: the regions it was the first to run, and its microseconds where the case was timed. Line 0 is before the body's first statement. */
export interface Statement {
  readonly line: number;
  readonly time?: number;
  /** Whole percent of the case, as {@link shareOf} reads it; absent where either time was not reported. */
  readonly share?: number;
  readonly regions: readonly OutcomeRegion[];
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
}

/** A case explained, with the record it was read from and the commit that record was written at. */
export interface RecordedExplanation extends ExplainedCase {
  readonly record: string;
  readonly commit?: string;
}

/** A case's statements from its times and the regions its newest run crossed, as {@link ExplainedCase} lays them out. */
export function statementsOf(
  test: Pick<ExecutionTest, 'file' | 'name' | 'duration' | 'times'>,
  regions: readonly ReadRegion[],
): ExplainedCase {
  const body = new Map<number, OutcomeRegion[]>();
  const hooks = new Map<number, OutcomeRegion[]>();
  const unlined: OutcomeRegion[] = [];
  for (const [file, name, path, startLine, endLine, value] of regions) {
    const region = { file, name, path, startLine, endLine };
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
  const statements: Statement[] = [
    ...before.map((line) => ({ line, regions: body.get(line)! })),
    ...times.map(({ line, time }) => {
      const share = shareOf(time, test.duration);
      return { line, time, ...(share === undefined ? {} : { share }), regions: body.get(line) ?? [] };
    }),
    ...rest.map((line) => ({ line, regions: body.get(line)! })),
  ];
  return {
    file: test.file,
    name: test.name,
    ...(test.duration === undefined ? {} : { duration: test.duration }),
    timed: test.times !== undefined,
    lined: body.size > 0 || hooks.size > 0,
    statements,
    hooks: [...hooks.keys()].sort((left, right) => left - right).map((line) => ({ line, regions: hooks.get(line)! })),
    unlined,
  };
}

/** Every case {@link namedCases} finds, explained from its newest run. */
export function recordedStatements(root: string, name: string, file?: string): RecordedExplanation[] {
  return [...namedCases(root, name, file, ['index'])].map(({ record, opened, test }) => {
    const commit = commitOf(record);
    return { ...statementsOf(test, newestRegions(opened, test.id) ?? []), record, ...(commit === undefined ? {} : { commit }) };
  });
}

/** The commit `record` was written at; absent outside a checkout or where it cannot be read. */
function commitOf(record: string): string | undefined {
  try {
    return askCoverageFile(record, (coverage) => coverage.commit);
  } catch {
    return undefined;
  }
}
