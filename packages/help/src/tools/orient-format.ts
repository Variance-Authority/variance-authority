/**
 * `docs_orient`'s answer, said from readings already made.
 *
 * Apart from the tool because everything here is a pure function of the files
 * asked about and what the source index and the recording answered, and a test that wants to
 * hold the wording should not need a repository, an index and a recording to
 * get a paragraph. Nothing is counted here: every share and every number is
 * the addon's, and this only chooses the words and the order.
 *
 * The answer is for an agent at a terminal. It is four parts, each one a
 * narrower reading of the one above it — the files asked about, which packages
 * they belong to and what crosses their edges, which recorded cases ran
 * those files, and the commands that ask about one name or one file — and a
 * part that could not be read is left out with one line saying why, so an
 * absent part is never mistaken for an empty one.
 */

// compass: variance-authority.report.agent-surface

import type { CasesEntered, ExternalOrientation, OrientFlows, PackagesAround, RecordedCases } from '@variance-authority/sense';

/** Everything an orientation answer is made of. */
export interface OrientReading {
  /** The files asked about, in the order asked. */
  readonly files: readonly string[];
  readonly around: PackagesAround;
  readonly external?: { readonly index: string; readonly orientation?: ExternalOrientation };
  readonly recorded: readonly RecordedCases[];
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** A share as a whole percent, and a share too small to round to one said as that. */
export function percent(share: number): string {
  const whole = Math.round(share * 100);
  return whole === 0 && share > 0 ? '<1%' : `${whole}%`;
}

/** An argument a shell passes through unchanged, quoted only when it would not be. */
function shell(value: string): string {
  return /^[\w@./:=+-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

/** A name as a reader would look for it: `*` is the whole module, not a name. */
const nameOf = (name: string): string => (name === '*' ? 'the whole module' : name);

function named(reading: OrientReading): readonly string[] {
  const { files } = reading;
  const owners = reading.around.orientation?.owners;
  const wide = Math.max(...files.map((file) => file.length));
  const rows = files.map((file, at) => {
    const owner = owners?.[at];
    if (owner === undefined) return `  ${file}`;
    const where = owner.indexed ? owner.package ?? 'no package' : 'not in the source index';
    return `  ${file.padEnd(wide)}  ${where}`;
  });
  return [`${plural(files.length, 'file')} asked about:`, ...rows];
}

function side(flows: OrientFlows, heading: string, indexed: number): readonly string[] {
  const unread = `imported names of ${plural(flows.unread, 'file')} were not read`;
  if (flows.units === 0) {
    // An empty side is only "none" when the index read this package and every file on the side.
    if (indexed === 0) return [`  ${heading}: not read. None of this package's files is in the index.`];
    return [`  ${heading}: ${flows.unread === 0 ? 'no package in this checkout.' : `none counted. The ${unread}.`}`];
  }
  const others = flows.rows.length + flows.more;
  const rows = flows.rows.map((row) => {
    const names = row.names.map((name) => `${nameOf(name.name)} ${percent(name.share)}`);
    if (row.moreNames > 0) names.push(`${plural(row.moreNames, 'more name')}`);
    return { share: percent(row.share), party: row.package ?? `files in no package`, names: names.join(', ') };
  });
  if (flows.more > 0) rows.push({ share: percent(flows.moreShare), party: plural(flows.more, 'more package'), names: '' });
  // Only a row followed by names is padded; the count of the rest has nothing after it to align.
  const wide = Math.max(0, ...rows.filter((row) => row.names !== '').map((row) => row.party.length));
  return [
    `  ${heading}, ${plural(others, 'package')}, ${plural(flows.units, 'use')}${flows.unread === 0 ? '' : ` (the ${unread})`}:`,
    ...rows.map((row) => `    ${row.share.padStart(4)}  ${row.names === '' ? row.party : `${row.party.padEnd(wide)}  ${row.names}`}`),
  ];
}

function packages(reading: OrientReading): readonly string[] {
  const { around } = reading;
  const orientation = around.orientation;
  if (orientation === undefined) {
    return [`Packages: no source index is published at ${around.index}. \`variance index\` publishes one.`];
  }
  const state = [
    `${plural(orientation.records, 'file')} indexed`,
    ...(orientation.stale > 0 ? [`${orientation.stale} changed or removed since`] : []),
    ...(orientation.unread > 0 ? [`${plural(orientation.unread, 'file')} whose imported names were not read`] : []),
    ...(orientation.dropped > 0 ? [`${plural(orientation.dropped, 'segment')} dropped for a failed digest`] : []),
  ];
  const lines = [
    `Packages, from the source index at ${around.index} (${state.join('; ')}).`,
    'A use is one file importing one name from another package. A package\'s share is of the uses on that side; ' +
      'a name\'s share is of every use the package exporting it gets from outside.',
  ];
  if (orientation.stale > 0) lines.push('`variance index` updates the index.');
  if (orientation.packages.length === 0) lines.push('', 'None of these files is in a package.');
  for (const one of orientation.packages) {
    lines.push(
      '',
      `${one.package}  ${one.directory === '' ? '(the root)' : one.directory}`,
      ...side(one.takes, 'Takes from', one.indexed),
      ...side(one.taken, 'Used by', one.indexed),
    );
  }
  return lines;
}

function external(reading: OrientReading): readonly string[] {
  const answer = reading.external?.orientation;
  if (answer === undefined) return [];
  const lines = [
    '',
    `External packages requested along local imports from these files (${plural(answer.reached, 'source file')} reached):`,
  ];
  if (answer.dependencies.length === 0) lines.push('  No external package request was read from this path.');
  for (const dependency of answer.dependencies) {
    const declared = dependency.declaredIn.length === 0
      ? 'no reached manifest declares it'
      : `declared in ${dependency.declaredIn.join(', ')}`;
    lines.push(`  ${dependency.package} — ${plural(dependency.files, 'file')}, ${plural(dependency.imports, 'request')}; ${declared}`);
    for (const site of dependency.sites) {
      const names = site.names.map(nameOf).join(', ');
      lines.push(`    ${site.file}:${site.line}  ${site.specifier} (${names}; ${site.distance} local imports away)`);
    }
    if (dependency.moreSites > 0) lines.push(`    ${plural(dependency.moreSites, 'more request')} not shown.`);
  }
  if (answer.more > 0) lines.push(`  ${plural(answer.more, 'more external package')} not shown.`);
  if (answer.declaredOnly.length > 0) {
    const more = answer.moreDeclaredOnly > 0 ? `, ${answer.moreDeclaredOnly} more` : '';
    lines.push(`  Declared locally without import evidence along this path: ${answer.declaredOnly.join(', ')}${more}.`);
  }
  if (answer.missing.length > 0) lines.push(`  Not in the source index: ${answer.missing.join(', ')}.`);
  if (answer.unread > 0 || answer.stale > 0 || answer.dropped > 0) {
    const action = answer.stale > 0 || answer.dropped > 0
      ? 'Run `variance index` to refresh changed or dropped records.'
      : 'The listed requests are observed evidence; unread files may add more.';
    lines.push(`  Incomplete reading: ${answer.unread} unread, ${answer.stale} changed since indexing, ${answer.dropped} dropped index segments. ${action}`);
  }
  return lines;
}

/** Names under a row, and how many were left out. */
function listed(names: readonly string[], count: number): readonly string[] {
  const more = count - names.length;
  return [...names.map((name) => `      ${name}`), ...(more > 0 && names.length > 0 ? [`      ${plural(more, 'more case')}.`] : [])];
}

/** Said once under the rows, because a row marked with it counts only part of what ran the file. */
const EVALUATED =
  '  * The recording names no case for what runs while a module evaluates. The cases whose files import the module ran it, ' +
  'and `variance covering --file` names them.';

function row(entered: CasesEntered, wide: number): readonly string[] {
  const file = entered.file.padEnd(wide);
  const declared = entered.declared ?? 0;
  const declares = listed(entered.declaredNames, declared);
  if (entered.cases == null) {
    // A test file is rarely a module anybody imports; the cases it declares are its row.
    if (declared > 0) return [`  ${file}  a test file declaring ${plural(declared, 'recorded case')}:`, ...declares];
    return [`  ${file}  not recorded: the recording has no row for this file.`];
  }
  const also = declared > 0 ? [`      It is also a test file declaring ${plural(declared, 'recorded case')}.`] : [];
  const titles = entered.titles.map((title) => `${title.file} > ${title.name}`);
  if (entered.cases === 0) {
    return [`  ${file}  ${entered.loaded === true ? 'ran only while its module evaluated.*' : 'recorded, and no case ran it.'}`, ...also];
  }
  const ran = entered.loaded === true
    ? `${plural(entered.cases, 'case')} ran it, and it also ran while its module evaluated*`
    : `${plural(entered.cases, 'case')} ran it`;
  return [`  ${file}  ${ran}${titles.length > 0 ? ':' : '.'}`, ...listed(titles, entered.cases), ...also];
}

function cases(reading: OrientReading): readonly string[] {
  const lines: string[] = [];
  for (const suite of reading.recorded) {
    const named = suite.suite === undefined ? 'Recorded cases' : `Recorded cases, suite ${suite.suite}`;
    if ('unread' in suite) {
      lines.push('', `${named}: none read from ${suite.recording}, ${suite.unread}. A run with \`withTestSelection\` records them.`);
      continue;
    }
    const wide = Math.max(...suite.files.map((entered) => entered.file.length));
    lines.push('', `${named}, from ${suite.recording}:`, ...suite.files.flatMap((entered) => row(entered, wide)));
    if (suite.files.some((entered) => entered.loaded === true)) lines.push(EVALUATED);
  }
  return lines;
}

/** The first name worth asking about: not the whole module, and not a default that has no name here. */
function namedIn(flows: OrientFlows): { readonly name: string; readonly package?: string } | undefined {
  for (const flow of flows.rows) {
    const name = flow.names.find((one) => one.name !== '*' && one.name !== 'default');
    if (name !== undefined) return { name: name.name, ...(flow.package == null ? {} : { package: flow.package }) };
  }
  return undefined;
}

/** Commands that ask about one name or one file this answer printed. */
export function followUps(reading: OrientReading): readonly string[] {
  const commands: string[] = [];
  const asked = reading.around.orientation?.packages ?? [];
  // The first name another package uses, from the first asked package anybody uses.
  for (const one of asked) {
    const taken = namedIn(one.taken);
    if (taken === undefined) continue;
    const flag = ` --package ${shell(one.package)}`;
    commands.push(`variance ask uses --name ${shell(taken.name)}${flag}`, `variance ask symbol --name ${shell(taken.name)}${flag}`);
    break;
  }
  const takes = asked[0] === undefined ? undefined : namedIn(asked[0].takes);
  if (takes?.package !== undefined) {
    const command = `variance ask symbol --name ${shell(takes.name)} --package ${shell(takes.package)}`;
    if (!commands.includes(command)) commands.push(command);
  }
  const ran = reading.recorded
    .flatMap((suite) => ('files' in suite ? suite.files.map((file) => ({ file, suite: suite.suite })) : []))
    .find((entry) => (entry.file.cases ?? 0) > 0 || entry.file.loaded === true);
  if (ran !== undefined) {
    commands.push(`variance covering --file ${shell(ran.file.file)}${ran.suite === undefined ? '' : ` --suite ${shell(ran.suite)}`}`);
  }
  return commands;
}

/** The whole answer. */
export function formatOrientation(reading: OrientReading): string {
  const asks = followUps(reading);
  return [
    ...named(reading),
    '',
    ...packages(reading),
    ...external(reading),
    ...cases(reading),
    ...(asks.length === 0 ? [] : ['', 'Narrower questions:', ...asks.map((command) => `  ${command}`)]),
  ].join('\n');
}
