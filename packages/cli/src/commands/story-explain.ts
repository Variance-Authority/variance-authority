/**
 * A case explained from the record every run writes, with no story taped:
 * `variance story --name` falls back here, and `recordedStatements` says what
 * the record holds of it — each statement once, at the line that first reached
 * it, its time and the regions it was the first to run.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordedCommit } from '@variance-authority/sense/test-selection';
import { recordedStatements, STORY_VARIABLE, type OutcomeRegion, type RecordedExplanation, type Statement, type StoryEntry } from '@variance-authority/sense/story';
import { packageName, packageOf } from '../package-home.js';
import { ranOf } from './covering-ran.js';
import { runsOnce } from './record-runs.js';
import { LISTED } from './story-compare.js';
import { regionText, untapedCase } from './story-outcomes.js';

/** A statement with its source text, as the checkout holds the line. */
export interface ExplainedStatement extends Statement {
  readonly text?: string;
}

/** A case explained, with what the checkout says of it now. */
export interface Explained extends Omit<RecordedExplanation, 'statements' | 'record' | 'id'> {
  readonly statements: readonly ExplainedStatement[];
  /** Whether the test file on disk is not the text its newest run ran over, as the runs record says, or why that is not known. */
  readonly moved: boolean | { readonly unknown: string };
  /** The package each region's file is in, by its manifest; a file under none is absent. */
  readonly packages: Readonly<Record<string, string>>;
}

/**
 * The case `name` names, explained from the record; nothing when a story of
 * it is taped among `stories`, or no record holds it, so the story's own
 * answer is given.
 */
export async function explainedCase(root: string, stories: readonly StoryEntry[], name: string | undefined, file: string | undefined): Promise<{ readonly explained: Explained } | undefined> {
  const found = untapedCase(stories, name, file, (named) => recordedStatements(root, named, file));
  if (found === undefined) return undefined;
  const { record, id, statements, ...rest } = found;
  const held = await readFile(join(root, rest.file), 'utf8').catch(() => undefined);
  const source = held?.split('\n');
  const packages: Record<string, string> = {};
  for (const { file: at } of [...statements, ...rest.hooks].flatMap((statement) => statement.regions).concat(rest.unlined)) {
    const home = packageOf(root, at);
    if (home !== undefined) packages[at] = packageName(root, home);
  }
  return {
    explained: {
      ...rest,
      moved: await movedSince(root, record, { id, file: rest.file, name: rest.name }, held),
      statements: statements.map((statement) => {
        const text = statement.line === 0 ? undefined : source?.[statement.line - 1]?.trim();
        return { ...statement, ...(text === undefined || text === '' ? {} : { text }) };
      }),
      packages,
    },
  };
}

/** Whether `held`, the test file as the checkout holds it, is not the text the case's newest run ran over, as {@link ranOf} reads the runs record. */
async function movedSince(root: string, record: string, test: { id: string; file: string; name: string }, held: string | undefined): Promise<Explained['moved']> {
  if (held === undefined) return { unknown: 'the test file is not on disk' };
  const at = await recordedCommit(record);
  const { ran } = await ranOf({ file: test.file, tests: [test] }, {
    root,
    snapshot: at === undefined ? undefined : record,
    at,
    runs: runsOnce(record, root),
    held,
  });
  if (ran === undefined) return { unknown: 'the record names no run of it' };
  if ('unread' in ran) return { unknown: ran.unread };
  const stand = ran.stands[0];
  if (stand?.text === 'held') return false;
  if (stand?.text === 'other') return true;
  return { unknown: stand?.unknown ?? 'the runs record holds no text it ran over' };
}

/** A case explained as text: its statements in the order first reached, each with the regions it was the first to run, then its hooks' and the unlined. */
export function formatExplained(explained: Explained, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify({ explained }, null, 2)}\n`;
  const text = [
    `explain  ${explained.file} > ${explained.name}, from the record`,
    '  each statement once, at the line that first reached it, with the regions it was the first to run;',
    `  for the order and the repeats, run the test with ${STORY_VARIABLE}=1 and read its story`,
  ];
  if (explained.moved === true) text.push('  the test file changed since its run, so a line may have moved');
  if (typeof explained.moved === 'object') text.push(`  could not tell whether the test file changed since its run: ${explained.moved.unknown}`);
  if (explained.duration !== undefined) text.push(`  ran ${explained.duration} ms`);
  if (!explained.lined) {
    text.push('  recorded without statement lines, so no region is charged to one');
  } else if (!explained.timed) {
    text.push('  not timed: its statements are listed by line');
  }
  const regions = (listedRegions: readonly OutcomeRegion[], indent: string) => {
    const byPackage = new Map<string, OutcomeRegion[]>();
    for (const region of listedRegions) {
      const home = explained.packages[region.file] ?? '(no package)';
      byPackage.set(home, [...byPackage.get(home) ?? [], region]);
    }
    for (const [home, inside] of byPackage) {
      text.push(`${indent}${home}`);
      // A declaration's arms ride its line, counted, so a statement reads by what it ran rather than by every branch.
      const declarations = new Map<string, { first: OutcomeRegion; arms: number }>();
      for (const region of inside) {
        const key = `${region.file}\0${region.name}`;
        const held = declarations.get(key);
        const whole = region.path === 'entry' || region.path === 'module';
        if (held === undefined) declarations.set(key, { first: region, arms: whole ? 0 : 1 });
        else declarations.set(key, { first: whole ? region : held.first, arms: held.arms + (whole ? 0 : 1) });
      }
      const shown = [...declarations.values()];
      for (const { first, arms } of shown.slice(0, LISTED)) {
        const within = first.path === 'entry' || first.path === 'module' ? arms : arms - 1;
        text.push(`${indent}  ${regionText(first)}${within === 0 ? '' : `, and ${within} ${within === 1 ? 'branch or loop' : 'branches or loops'} in it`}`);
      }
      if (shown.length > LISTED) text.push(`${indent}  and ${shown.length - LISTED} more`);
    }
  };
  const width = Math.max(0, ...explained.statements.map(({ line }) => String(line).length));
  for (const statement of explained.statements) {
    if (statement.line === 0) {
      text.push('', '  before the first statement');
    } else {
      const time = statement.time === undefined ? '' : `  ${timeText(statement.time).padStart(8)}`;
      const share = statement.share === undefined ? '' : `  ${`${statement.share}%`.padStart(4)}`;
      text.push('', `  line ${String(statement.line).padEnd(width)}${time}${share}${statement.text === undefined ? '' : `  ${statement.text}`}`);
    }
    regions(statement.regions, '    ');
  }
  if (explained.hooks.length > 0) {
    text.push('', '  in hooks, apart from the statements');
    for (const hook of explained.hooks) {
      text.push(`    line ${hook.line}`);
      regions(hook.regions, '      ');
    }
  }
  if (explained.unlined.length > 0) {
    text.push('', `  no line recorded: ${explained.unlined.length} ${explained.unlined.length === 1 ? 'region' : 'regions'}`);
    regions(explained.unlined, '    ');
  }
  return `${text.join('\n')}\n`;
}

/** Microseconds under a millisecond, milliseconds to a tenth above it. */
function timeText(time: number): string {
  return time < 1000 ? `${time} µs` : `${(time / 1000).toFixed(1)} ms`;
}
