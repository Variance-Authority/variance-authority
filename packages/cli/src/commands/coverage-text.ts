// compass: variance-authority.reach.crossings
/**
 * `variance coverage`'s answer, for a person, for a pull request, and for a
 * program.
 *
 * Every ratio is printed over the regions any suite loaded, and a suite's arrow
 * is printed with the parts that add up to it, because a percentage that fell
 * says nothing about which of three things happened: a test stopped running
 * code, code was deleted, or code the other suites run was written.
 */

import type { TestFileMotion } from '@variance-authority/sense/test-selection';
import { coverageParts as parts, coverageRows, grouped, ratio } from './coverage-summary.js';
import { text as escape } from './report-html-elements.js';
import type { CoverageFormat } from '../coverage-args.js';
import type { CoverageSource } from './coverage-source.js';
import type { Coverage, CoverageSuite, UnloadedChange } from './coverage.js';

/** How many test files are named under a suite whose count changed. */
const NAMED_TEST_FILES = 3;
/** How many files a change no suite loads names before it counts the rest. */
const NAMED_CHANGED_FILES = 5;
/** How many directories of unloaded files the text names; the JSON has every file. */
const NAMED_DIRECTORIES = 5;

export function formatCoverage(answer: Coverage, format: CoverageFormat): string {
  if (format === 'json') return `${JSON.stringify(answer, null, 2)}\n`;
  return format === 'markdown' ? markdown(answer) : text(answer);
}

function text(answer: Coverage): string {
  const { count, base } = answer;
  const lines = [heading(answer)];
  const rows: (readonly string[])[] = [];
  rows.push(['  any suite', '', countCell(count.run, base?.run), ratioCell(count.run, count.regions, base?.run, base?.regions), '']);
  let counted = 0;
  for (const suite of answer.suites) {
    const name = `    ${suite.suite ?? 'the record'}`;
    if (suite.from === undefined) {
      rows.push([name, suite.kind ?? '', 'unrecorded', '', '']);
      continue;
    }
    const now = count.suites[counted]!;
    const was = base?.suites[counted];
    counted += 1;
    rows.push([
      name,
      suite.kind ?? '',
      countCell(now.run, was?.run),
      ratioCell(now.run, count.regions, was?.run, base?.regions),
      base === undefined || suite.base === undefined
        ? suite.recorded === undefined ? '' : `recorded at ${short(suite.recorded)}`
        : parts(suite.base.change).join(' · '),
    ]);
  }
  lines.push(...table(rows));

  const tail: (readonly string[])[] = [];
  if (count.overlap !== undefined) {
    const alone = Object.entries(count.overlap.alone).map(([kind, regions]) => `${kind} ${grouped(regions)}`);
    const solo = Object.values(count.overlap.alone).reduce((sum, regions) => sum + regions, 0);
    tail.push(['  more than one kind', grouped(count.overlap.several), '']);
    tail.push(['  one kind alone', grouped(solo), alone.join(' · ')]);
  }
  tail.push(['  nothing ran', grouped(count.none), '']);
  if (count.load > 0) tail.push(['  ran only at load', grouped(count.load), '']);
  lines.push(...table(tail));
  if (count.unjoined > 0) lines.push(`not joined across suites: ${grouped(count.unjoined)} region${count.unjoined === 1 ? '' : 's'}`);
  lines.push(...sourceLines(answer));

  if (base !== undefined) {
    for (const suite of answer.suites) {
      if (suite.base === undefined) continue;
      lines.push(...namedTestFiles(suite, suite.base.change.testFiles));
    }
    lines.push('', ...answer.suites.flatMap((suite) => suite.base === undefined ? [] : [
      `${suite.suite ?? 'the record'} compared with ${suite.base.from}, recorded at ${short(suite.base.commit)}`,
    ]));
  } else {
    const missed = answer.suites.filter((suite) => suite.baseMissed !== undefined);
    if (missed.length > 0 && missed.length < answer.suites.filter((suite) => suite.from !== undefined).length) {
      lines.push('', 'no comparison: a suite with no base changes the total every other suite is compared over');
    }
    for (const suite of missed) lines.push(`${suite.suite ?? 'the record'}: ${suite.baseMissed!}`);
  }
  return `${lines.join('\n')}\n`;
}

function heading(answer: Coverage): string {
  const at = answer.at === undefined ? 'coverage' : `coverage at ${short(answer.at)}`;
  const regions = regionCount(answer.count.regions);
  const files = `${grouped(answer.count.files)} file${answer.count.files === 1 ? '' : 's'} the suites loaded`;
  if (answer.base === undefined) return `${at} — ${regions} in ${files}`;
  return `${at} against each suite's base — ${regions} (${grouped(answer.base.regions)} at the base) in ${files}`;
}

/** The test files whose reach changed most, under the suite they belong to. */
function namedTestFiles(suite: CoverageSuite, testFiles: readonly TestFileMotion[]): readonly string[] {
  const left = [...testFiles].filter((file) => file.left.length > 0).sort((a, b) => b.left.length - a.left.length || order(a.file, b.file));
  const entered = [...testFiles].filter((file) => file.entered.length > 0).sort((a, b) => b.entered.length - a.entered.length || order(a.file, b.file));
  const lines: string[] = [];
  for (const file of left.slice(0, NAMED_TEST_FILES)) {
    lines.push(`  ${suite.suite ?? 'the record'}: ${file.file} no longer runs ${regionCount(file.left.length)} it ran at the base`);
  }
  for (const file of entered.slice(0, NAMED_TEST_FILES)) {
    lines.push(`  ${suite.suite ?? 'the record'}: ${file.file} now runs ${regionCount(file.entered.length)} it did not run at the base`);
  }
  return lines;
}

/** The summary gives each suite one row; inventories stay behind named disclosures. */
function markdown(answer: Coverage): string {
  if (answer.unloadedChange !== undefined) return `${unloadedMarkdown(answer.unloadedChange, answer.suites)}\n`;
  const lines = [
    '| Suite | Regions executed by cases | Compared with baseline |',
    '|---|--:|---|',
    ...coverageRows(answer, true),
    '',
    `Percentages count the ${regionCount(answer.count.regions)} in ${files(answer.count.files)} the recorded suites loaded. Module-load execution is counted separately.`,
    ...coverageBreakdown(answer),
  ];
  return `${lines.join('\n')}\n`;
}

/** Detailed counts and provenance, shared with the combined review. */
export function coverageBreakdown(answer: Coverage): readonly string[] {
  const { count, base } = answer;
  const label = answer.suites.length === 1 ? answer.suites[0]!.suite ?? 'the record' : 'All recorded suites';
  const lines = ['', `<details><summary>${escape(label)}: execution breakdown and changed regions</summary>`, '', `<sub>${escape(heading(answer))}</sub>`, ''];
  if (answer.suites.filter((suite) => suite.from !== undefined).length > 1) {
    lines.push(`Any suite: ${countCell(count.run, base?.run)} regions executed by cases (${ratioCell(count.run, count.regions, base?.run, base?.regions)}).`, '');
  }
  const share = (regions: number) => ratio(regions, count.regions);
  lines.push('| Execution | Regions | Share |', '|---|--:|--:|');
  const kinds = Object.entries(count.overlap?.alone ?? {});
  if (count.overlap !== undefined && kinds.length > 1) {
    lines.push(`| More than one kind | ${grouped(count.overlap.several)} | ${share(count.overlap.several)} |`);
    for (const [kind, regions] of kinds) lines.push(`| ${kind} alone | ${grouped(regions)} | ${share(regions)} |`);
  } else {
    lines.push(`| Executed by cases | ${grouped(count.run)} | ${share(count.run)} |`);
  }
  if (count.load > 0) lines.push(`| Module-load execution only | ${grouped(count.load)} | ${share(count.load)} |`);
  lines.push(`| Not executed | ${grouped(count.none)} | ${share(count.none)} |`);
  if (count.unjoined > 0) lines.push('', `${grouped(count.unjoined)} regions could not be joined across suites.`);
  for (const suite of answer.suites) {
    const name = suite.suite ?? 'the record';
    if (suite.recorded !== undefined) lines.push('', `${name} recorded at ${short(suite.recorded)}.`);
    if (suite.base !== undefined) {
      lines.push('', `${name} compared with ${short(suite.base.commit)}.`);
      lines.push('', `Regions that changed the count: ${parts(suite.base.change).join(' · ')}.`);
      lines.push(...namedTestFiles(suite, suite.base.change.testFiles).map((line) => `- ${line.trim()}`));
    }
    if (suite.baseMissed !== undefined) lines.push('', `${name}: ${suite.baseMissed}`);
  }
  if (base === undefined && answer.suites.some((suite) => suite.base !== undefined)) {
    lines.push('', 'No aggregate comparison: not every recorded suite has a baseline.');
  }
  lines.push('', '</details>');
  if (answer.source !== undefined || answer.sourceMissed !== undefined) {
    lines.push('', `<details><summary>${escape(label)}: source beyond the recordings</summary>`, ...sourceMarkdown(answer), '', '</details>');
  }
  return lines;
}

/**
 * A change no suite loads, as the one sentence a reviewer needs: every count
 * is the base's, so the tables would repeat the mainline's report under a
 * change that did not touch it.
 */
function unloadedMarkdown(change: UnloadedChange, suites: readonly CoverageSuite[]): string {
  const one = change.files.length === 1;
  const named = change.files.slice(0, NAMED_CHANGED_FILES).map((file) => `\`${file}\``);
  const more = change.files.length - named.length;
  const list = more > 0 ? `${named.join(', ')} and ${grouped(more)} more` : joined(named);
  const what = one ? `${list} changed` : `${grouped(change.files.length)} files changed`;
  const which = one ? '' : ` — ${list} —`;
  const names = suites.map((suite) => suite.suite).filter((name) => name !== undefined);
  const loads = names.length <= 1
    ? `${names.length === 0 ? 'the suite' : `the ${names[0]} suite`} ${one ? 'does not load it' : 'loads none of them'}`
    : `none of the ${joined(names)} suites loads ${one ? 'it' : 'any of them'}`;
  return `📊 ${what} since the base was recorded at ${short(change.since)}${which}${one ? ',' : ''} and ${loads}, so coverage is the same as at the base.`;
}

/** `a`, `a and b`, `a, b and c`. */
function joined(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;
}

/** The files no suite recorded: the total first, the table of where they are folded under it. */
function sourceMarkdown(answer: Coverage): readonly string[] {
  const { source } = answer;
  if (source === undefined) return answer.sourceMissed === undefined ? [] : ['', `🗂️ Files no suite recorded: not counted, because ${answer.sourceMissed}.`];
  const { unloaded, before } = source;
  const early = before?.regions ?? 0;
  const lines = ['', [
    `🗂️ ${sourceSubject(source)} with ${regionCount(source.regions)}, and **${ratio(source.ran, source.regions)}** of those regions ran.`,
    ...(early === 0 ? [] : [`${ratio(early, source.ran)} of what ran is code the test harness loads before any test starts.`]),
    ...(unloaded.files > 0 ? [`No suite recorded ${grouped(unloaded.files)} of those files.`] : []),
  ].join(' ')];
  for (const pattern of source.unmatched ?? []) lines.push(`- the entry point \`${pattern}\` matches no file`);
  const row = (label: string, size: { files: number; lines: number; regions: number }) =>
    `| ${label} | ${grouped(size.files)} | ${grouped(size.lines)} | ${grouped(size.regions)} |`;
  const rows: string[] = [];
  if (before !== undefined && before.files > 0) rows.push(row('⚙️ loaded by the test harness', before));
  if (unloaded.files > 0) {
    rows.push(row('🔴 recorded by no suite', unloaded));
    rows.push(...unloaded.directories.slice(0, NAMED_DIRECTORIES).map((size) => row(`&emsp;\`${size.directory}\``, size)));
    if (unloaded.directories.length > NAMED_DIRECTORIES) {
      rows.push(`| &emsp;and ${grouped(unloaded.directories.length - NAMED_DIRECTORIES)} more directories | | | |`);
    }
  }
  if (rows.length === 0) {
    lines.push('', "Every one is in a suite's record.");
  } else {
    // The table holds both rows when both have files, so the summary names both.
    const harnessed = before === undefined || before.files === 0 ? undefined : `the ${files(before.files)} the test harness loads`;
    const fold = unloaded.files === 0
      ? `⚙️ The ${files(before!.files)} the test harness loads`
      : `📦 The ${files(unloaded.files)} no suite recorded, by directory${harnessed === undefined ? '' : `, and ${harnessed}`}`;
    lines.push('', `<details><summary>${fold}</summary>`, '');
    lines.push('| | Files | Lines | Regions |', '|---|--:|--:|--:|', ...rows);
    if (unloaded.uncut > 0) lines.push('', `${files(unloaded.uncut)} did not parse, so no regions are counted for them.`);
    lines.push('', '</details>');
  }
  const entries = answer.entries ?? [];
  if (entries.length > 0) {
    const share = (scope: CoverageSource) => ratio(scope.before?.regions ?? 0, scope.ran);
    lines.push('', `<details><summary>📁 How much of each of ${grouped(entries.length)} directories ran</summary>`, '');
    lines.push(
      'Each directory is counted twice: over its own files, and over its own files with everything they import. ' +
        '*Harness* is the share of what ran that is code the test harness loads before any test starts.',
      '',
    );
    lines.push('| Directory | Own files ran | Harness | With imports ran | Harness |', '|---|--:|--:|--:|--:|');
    for (const entry of entries) {
      lines.push('missed' in entry
        ? `| \`${entry.from}\` | ${entry.missed} | | | |`
        : `| \`${entry.from}\` | ${ratio(entry.own.ran, entry.own.regions)} | ${share(entry.own)} | ${ratio(entry.uses.ran, entry.uses.regions)} | ${share(entry.uses)} |`);
    }
    lines.push('', '</details>');
  }
  return lines;
}

/** The source in scope, what the harness loads and the files no suite recorded, or why the index could not say. */
function sourceLines(answer: Coverage): readonly string[] {
  const { source } = answer;
  if (source === undefined) return answer.sourceMissed === undefined ? [] : [`files no suite recorded: not counted, because ${answer.sourceMissed}`];
  const lines = [`source: ${files(source.files)} ${sourceWhere(source)}`];
  for (const pattern of source.unmatched ?? []) lines.push(`  the entry point ${pattern} matches no file`);
  const { unloaded, before } = source;
  const sized = (label: string, row: { files: number; lines: number; regions: number }) =>
    [label, files(row.files), `${grouped(row.lines)} lines`, regionCount(row.regions)];
  const rows = before === undefined || before.files === 0 ? [] : [sized('  before reach', before)];
  if (unloaded.files > 0) {
    rows.push(sized('  recorded by no suite', unloaded));
    rows.push(...unloaded.directories.slice(0, NAMED_DIRECTORIES).map((row) => sized(`    ${row.directory}`, row)));
  }
  lines.push(...table(rows));
  if (rows.length === 0) return [...lines, "  every one is in a suite's record", ...entryLines(answer.entries ?? [])];
  if (unloaded.directories.length > NAMED_DIRECTORIES) {
    lines.push(`    and ${grouped(unloaded.directories.length - NAMED_DIRECTORIES)} more directories; --format json lists every file`);
  }
  if (unloaded.uncut > 0) lines.push(`  ${files(unloaded.uncut)} did not parse, so no regions are counted for them`);
  lines.push(`  total coverage for ${grouped(source.ran)} of the ${regionCount(source.regions)}: ${sourceRatio(source)}`);
  return [...lines, ...entryLines(answer.entries ?? [])];
}

/** Which files the source counts, as `--from` chose them. */
function sourceWhere(source: CoverageSource): string {
  if (source.seeds === 'entrypoints') {
    return source.from === undefined ? 'reached from the declared entry points' : `reached from the entry points of ${source.from}`;
  }
  return source.seeds === 'directory' ? `reached from every file under ${source.from}, which declares no entry points` : 'in the source index';
}

/** Which files the source counts, as `--from` chose them, as the subject of the comment's sentence. */
function sourceSubject(source: CoverageSource): string {
  const counted = files(source.files);
  if (source.seeds === 'entrypoints') {
    const who = source.from === undefined ? 'The declared entry points' : `The entry points of \`${source.from}\``;
    return `${who} import ${counted}, directly or through other files,`;
  }
  return source.seeds === 'directory'
    ? `\`${source.from}\` declares no entry points, so every file under it and what those import come to ${counted},`
    : `The source index lists ${counted}`;
}

/** One row per directory: its own files, then everything it reaches, each with its share before reach. */
function entryLines(entries: NonNullable<Coverage['entries']>): readonly string[] {
  if (entries.length === 0) return [];
  const before = (source: CoverageSource) => ratio(source.before?.regions ?? 0, source.ran);
  return table([
    ['', 'own', 'before reach', 'with imports', 'before reach'],
    ...entries.map((entry) => 'missed' in entry
      ? [`  ${entry.from}`, entry.missed]
      : [`  ${entry.from}`, ratio(entry.own.ran, entry.own.regions), before(entry.own), ratio(entry.uses.ran, entry.uses.regions), before(entry.uses)]),
  ]);
}

/** The share of the source run, and how much of the run is before reach. */
function sourceRatio(source: CoverageSource): string {
  const before = source.before?.regions ?? 0;
  const share = ratio(source.ran, source.regions);
  return before === 0 ? share : `${share}, ${ratio(before, source.ran)} before reach`;
}

function countCell(now: number, was: number | undefined): string {
  return was === undefined ? grouped(now) : `${grouped(was)} → ${grouped(now)}`;
}

function ratioCell(run: number, regions: number, wasRun: number | undefined, wasRegions: number | undefined): string {
  const now = ratio(run, regions);
  return wasRun === undefined || wasRegions === undefined ? now : `${ratio(wasRun, wasRegions)} → ${now}`;
}

/** Columns padded to the widest cell, with no trailing space. */
function table(rows: readonly (readonly string[])[]): readonly string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, at) => (widths[at] = Math.max(widths[at] ?? 0, cell.length)));
  return rows.map((row) => row.map((cell, at) => cell.padEnd(widths[at]!)).join('  ').trimEnd());
}

function regionCount(regions: number): string {
  return `${grouped(regions)} region${regions === 1 ? '' : 's'}`;
}

function files(count: number): string {
  return `${grouped(count)} file${count === 1 ? '' : 's'}`;
}

function short(commit: string): string {
  return commit.slice(0, 8);
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
