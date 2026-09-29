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

import type { CoverageCount, SuiteChange, SuiteCount, TestFileMotion } from '@variance-authority/sense/test-selection';
import type { CoverageFormat } from '../coverage-args.js';
import type { CoverageSource } from './coverage-source.js';
import type { Coverage, CoverageSuite } from './coverage.js';

/** How many test files are named under a suite whose count changed. */
const NAMED_TEST_FILES = 3;
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
      `${suite.suite ?? 'the record'} compared with ${suite.base.from}${suite.base.commit === undefined ? '' : `, recorded at ${short(suite.base.commit)}`}`,
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

/** The parts a suite's change in count is made of, the ones that are not zero. */
function parts(change: SuiteChange): readonly string[] {
  const said: string[] = [];
  if (change.gained > 0) said.push(`gained ${grouped(change.gained)}`);
  if (change.lost > 0) said.push(`lost ${grouped(change.lost)}`);
  if (change.hidden > 0) said.push(`hidden ${grouped(change.hidden)}`);
  if (change.written.regions > 0) said.push(`written ${grouped(change.written.regions)}, ${grouped(change.written.run)} run`);
  if (change.deleted.regions > 0) said.push(`deleted ${grouped(change.deleted.regions)}, ${grouped(change.deleted.run)} had run`);
  if (change.arrived.files.length > 0) {
    said.push(`now loads ${files(change.arrived.files.length)}, ${grouped(change.arrived.run)} of ${grouped(change.arrived.regions)} run`);
  }
  if (change.departed.files.length > 0) {
    said.push(`no longer loads ${files(change.departed.files.length)}, ${grouped(change.departed.run)} had run`);
  }
  return said.length === 0 ? ['no change'] : said;
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

function markdown(answer: Coverage): string {
  const { count, base } = answer;
  const compared = base !== undefined;
  const lines = [`### ${heading(answer)}`, ''];
  lines.push(compared ? '| Suite | Kind | Regions run | Share | What changed it |' : '| Suite | Kind | Regions run | Share |');
  lines.push(compared ? '|---|---|--:|--:|---|' : '|---|---|--:|--:|');
  lines.push(`| any suite | | ${countCell(count.run, base?.run)} | ${ratioCell(count.run, count.regions, base?.run, base?.regions)} |${compared ? ' |' : ''}`);
  let counted = 0;
  for (const suite of answer.suites) {
    const name = suite.suite ?? 'the record';
    if (suite.from === undefined) {
      lines.push(`| ${name} | ${suite.kind ?? ''} | unrecorded | |${compared ? ' |' : ''}`);
      continue;
    }
    const now: SuiteCount = count.suites[counted]!;
    const was = base?.suites[counted];
    counted += 1;
    lines.push(
      `| ${name} | ${suite.kind ?? ''} | ${countCell(now.run, was?.run)} | ${ratioCell(now.run, count.regions, was?.run, base?.regions)} |` +
        (compared && suite.base !== undefined ? ` ${parts(suite.base.change).join(' · ')} |` : ''),
    );
  }
  lines.push('');
  lines.push(...overlapLines(count).map((line) => `- ${line}`));
  lines.push(...sourceLines(answer).map((line) => `- ${line.trim()}`));
  for (const suite of answer.suites) {
    if (suite.baseMissed !== undefined) lines.push(`- ${suite.suite ?? 'the record'}: ${suite.baseMissed}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The source in scope, what the harness loads and the files no suite recorded, or why the index could not say. */
function sourceLines(answer: Coverage): readonly string[] {
  const { source } = answer;
  if (source === undefined) return answer.sourceMissed === undefined ? [] : [`files no suite recorded: not counted, because ${answer.sourceMissed}`];
  const where = source.seeds === 'entrypoints'
    ? source.from === undefined ? 'reached from the declared entry points' : `reached from the entry points of ${source.from}`
    : source.seeds === 'directory'
      ? `reached from every file under ${source.from}, which declares no entry points`
      : 'in the source index';
  const lines = [`source: ${files(source.files)} ${where}`];
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

function overlapLines(count: CoverageCount): readonly string[] {
  const lines: string[] = [];
  if (count.overlap !== undefined) {
    lines.push(`more than one kind ran ${regionCount(count.overlap.several)}`);
    for (const [kind, regions] of Object.entries(count.overlap.alone)) lines.push(`only ${kind} ran ${regionCount(regions)}`);
  }
  lines.push(`nothing ran ${regionCount(count.none)}`);
  if (count.load > 0) lines.push(`${regionCount(count.load)} ran only while their module loaded`);
  if (count.unjoined > 0) lines.push(`${regionCount(count.unjoined)} not joined across suites`);
  return lines;
}

function countCell(now: number, was: number | undefined): string {
  return was === undefined ? grouped(now) : `${grouped(was)} -> ${grouped(now)}`;
}

function ratioCell(run: number, regions: number, wasRun: number | undefined, wasRegions: number | undefined): string {
  const now = ratio(run, regions);
  return wasRun === undefined || wasRegions === undefined ? now : `${ratio(wasRun, wasRegions)} -> ${now}`;
}

function ratio(run: number, regions: number): string {
  return regions === 0 ? '—' : `${((run / regions) * 100).toFixed(1)}%`;
}

/** Columns padded to the widest cell, with no trailing space. */
function table(rows: readonly (readonly string[])[]): readonly string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, at) => (widths[at] = Math.max(widths[at] ?? 0, cell.length)));
  return rows.map((row) => row.map((cell, at) => cell.padEnd(widths[at]!)).join('  ').trimEnd());
}

/** Thousands grouped with commas, whatever `LANG` says. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
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
