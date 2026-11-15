/**
 * A case explained from the record every run writes, with no story taped:
 * `variance story --name` falls back here, and `recordedStatements` says what
 * the record holds of it — each statement once, at the line that first reached
 * it, its time and the regions it was the first to run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordedStatements, STORY_VARIABLE, type OutcomeRegion, type RecordedExplanation, type Statement, type StoryEntry } from '@variance-authority/sense/story';
import { packageName, packageOf } from '../package-home.js';
import { LISTED } from './story-compare.js';
import { regionText, untapedCase } from './story-outcomes.js';

/** A statement with its source text, as the checkout holds the line. */
export interface ExplainedStatement extends Statement {
  readonly text?: string;
}

/** A case explained, with what the checkout says of it now. */
export interface Explained extends Omit<RecordedExplanation, 'statements' | 'commit'> {
  readonly statements: readonly ExplainedStatement[];
  /** Whether the test file changed since the record was written; absent where that could not be told. */
  readonly moved?: boolean;
  /** The package each region's file is in, by its manifest; a file under none is absent. */
  readonly packages: Readonly<Record<string, string>>;
}

/**
 * The case `name` names, explained from the record; nothing when a story of
 * it is taped among `stories`, or no record holds it, so the story's own
 * answer is given.
 */
export function explainedCase(root: string, stories: readonly StoryEntry[], name: string | undefined, file: string | undefined): { readonly explained: Explained } | undefined {
  const found = untapedCase(stories, name, file, (named) => recordedStatements(root, named, file));
  if (found === undefined) return undefined;
  const { commit, statements, ...rest } = found;
  const source = sourceLines(root, rest.file);
  const packages: Record<string, string> = {};
  for (const { file: at } of [...statements, ...rest.hooks].flatMap((statement) => statement.regions).concat(rest.unlined)) {
    const home = packageOf(root, at);
    if (home !== undefined) packages[at] = packageName(root, home);
  }
  const moved = changedSince(root, commit, rest.file);
  return {
    explained: {
      ...rest,
      ...(moved === undefined ? {} : { moved }),
      statements: statements.map((statement) => {
        const text = statement.line === 0 ? undefined : source?.[statement.line - 1]?.trim();
        return { ...statement, ...(text === undefined || text === '' ? {} : { text }) };
      }),
      packages,
    },
  };
}

function sourceLines(root: string, file: string): string[] | undefined {
  try {
    return readFileSync(join(root, file), 'utf8').split('\n');
  } catch {
    return undefined;
  }
}

/** Whether `file` differs from what `commit` held; absent with no commit, or where git cannot say. */
function changedSince(root: string, commit: string | undefined, file: string): boolean | undefined {
  if (commit === undefined) return undefined;
  try {
    // A file the commit does not hold is not unchanged, and `git diff` says nothing of an untracked one.
    execFileSync('git', ['cat-file', '-e', `${commit}:./${file}`], { cwd: root, stdio: 'pipe' });
  } catch {
    return undefined;
  }
  try {
    execFileSync('git', ['diff', '--quiet', commit, '--', file], { cwd: root, stdio: 'pipe' });
    return false;
  } catch (error) {
    return (error as { status?: number }).status === 1 ? true : undefined;
  }
}

/** A case explained as text: its statements in the order first reached, each with the regions it was the first to run, then its hooks' and the unlined. */
export function formatExplained(explained: Explained, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify({ explained }, null, 2)}\n`;
  const text = [
    `explain  ${explained.file} > ${explained.name}, from the record`,
    '  each statement once, at the line that first reached it, with the regions it was the first to run;',
    `  for the order and the repeats, run the test with ${STORY_VARIABLE}=1 and read its story`,
  ];
  if (explained.moved === true) text.push('  the test file changed since the record was written, so a line may have moved');
  if (explained.moved === undefined) text.push('  could not tell whether the test file changed since the record was written');
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
