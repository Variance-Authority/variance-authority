// compass: variance-authority.reach
/**
 * How fresh and how actual a `covering` answer is, said under it: where its
 * line numbers stand in the asked text, and, for each test file it names,
 * whether that file ran over the asked text and when its runs landed.
 *
 * Two questions, kept apart. The frame says how the record's line numbers are
 * placed in the asked text, and nothing else. Whether a test file ran over the
 * asked text is said once, per test file, from what `covering-ran.ts` read.
 * Time is the landing time of the runs a test file last ran in; a commit is
 * where a run stood, carried in the JSON, and never leads a sentence.
 */

import { staleFile, staleLines } from './covering-stale.js';
import type { CoveringRan, Landed, RanStand } from './covering-ran.js';
import type { Covering, CoveringTarget } from './covering.js';

/**
 * Where the asked file's line numbers stand, said once under the answer;
 * nothing when they are numbered in the asked text. A stale answer about the
 * file or its lines says it first instead, since it is the reason no line is
 * given; one about a function says it here, with what it takes away.
 */
export function frameText(answer: Covering): readonly string[] {
  const { file, target } = answer;
  if (answer.changed !== undefined || file === undefined || staleFile(answer)) return [];
  // A stale answer about the file or its lines was said above; this one asks of a function.
  if (answer.frame === 'stale' && target !== undefined) return [`${staleLines(answer).gone} Which parts of ${regionName(target)} no case ran are not said for that reason.`];
  if (answer.frame === 'recorded') return [];
  if (answer.frame === 'mapped') return [`The recorded lines of ${file} are placed in its text as it is now.`];
  // A precondition has no recorded line to be the record's, nor any to number.
  if (answer.unheld === true) return [`${file} is not on disk, so no text of it is held${answer.preconditionOf === undefined ? "; its lines are the record's" : ''}.`];
  if (answer.preconditionOf !== undefined) return [];
  return [`The record does not say which text of ${file} its lines are numbered in, so they are given as recorded.`];
}

/**
 * Whether each test file the answer names ran over the asked text, and when,
 * in lines ordered by when their runs landed, the oldest first. The test files
 * that ran over it are said in one line; each group that ran over another
 * text, or whose text is not known, in one of its own, by name; a test file
 * whose named cases last ran in different runs, in one of its own, part by
 * part. A changed file off disk is said first, and no line says a test file
 * ran over it.
 *
 * @param now The clock the answer is dated against, in ms.
 */
export function ranText(answer: Covering, now: number): readonly string[] {
  const ran = answer.ran;
  if (ran === undefined) return [];
  if ('unread' in ran) return [`Where and when ${subject(ran, ran.tests.length, false)} last ran is not known: ${ran.unread}.`];
  // A changed file off disk has no text to compare, so no line says any test file ran over it.
  const unheld = ran.unheld ?? [];
  const asked = askedFiles(answer).filter((file) => !unheld.includes(file));
  const stands = [...ran.stands].sort((one, other) => (one.landed?.latest ?? '').localeCompare(other.landed?.latest ?? ''));
  // A test file whose named cases last ran in different runs is said part by part, in a line of its own.
  const whole = stands.filter((stand) => stand.cases === undefined);
  const parted = new Map<string, RanStand[]>();
  for (const stand of stands) if (stand.cases !== undefined) parted.set(stand.tests[0]!, [...(parted.get(stand.tests[0]!) ?? []), stand]);
  const all = new Set(stands.flatMap((stand) => stand.tests)).size;
  const held = whole.filter((stand) => stand.text === 'held');
  const uncompared = whole.filter((stand) => stand.text === undefined && stand.unknown === undefined);
  const lines: { readonly at: string; readonly said: string }[] = [];
  const counted = (group: readonly RanStand[]): { count: number; others: boolean } => {
    const count = group.reduce((sum, stand) => sum + stand.tests.length, 0);
    return { count, others: count < all };
  };
  if (held.length > 0) {
    const { count, others } = counted(held);
    const verb = asked.length === 1 ? 'is the text' : 'are the texts';
    lines.push({ at: earliest(held), said: `${list(asked, 'other files')} ${verb} ${subject(ran, count, others)} ran over, ${when(held, now)}.` });
  }
  if (uncompared.length > 0) {
    const { count, others } = counted(uncompared);
    lines.push({ at: earliest(uncompared), said: `${capital(subject(ran, count, others))} last ran ${when(uncompared, now)}.` });
  }
  for (const stand of whole) {
    const names = list(stand.tests, 'other test files');
    if (stand.text === 'other') {
      const of = list(stand.other ?? asked, 'other files');
      lines.push({ at: earliest([stand]), said: `${names} ran over another text of ${of}, ${when([stand], now)}${regionText(answer, stand)}.` });
    } else if (stand.unknown !== undefined) {
      const of = list(asked, 'other files');
      lines.push({ at: earliest([stand]), said: `Whether ${names} ran over ${of} as it is now, ${when([stand], now)}, is not known: ${stand.unknown}.` });
    }
  }
  for (const [test, parts] of parted) lines.push({ at: earliest(parts), said: partsText(answer, ran, test, parts, asked, now) });
  const off = unheld.length === 1 ? 'is not on disk, so no text of it is held' : 'are not on disk, so no text of them is held';
  const said = [
    ...(unheld.length === 0 ? [] : [`${list(unheld, 'other files')} ${off}.`]),
    ...lines.sort((one, other) => one.at.localeCompare(other.at)).map((line) => line.said),
  ];
  const assumed = new Set(stands.filter((stand) => stand.assumed === true).flatMap((stand) => stand.tests)).size;
  if (assumed === 0) return said;
  const whose = assumed === all ? subject(ran, all, false) : `${String(assumed)} of them`;
  return [...said, `The record does not say where ${whose} last ran, so where ${assumed === 1 ? 'it' : 'they'} ran is assumed, not observed.`];
}

/**
 * One test file whose named cases last ran in different runs, part by part,
 * the newest first: each part by its cases' names, and the oldest by how many
 * cases it holds, with the text they ran over and when.
 */
function partsText(answer: Covering, ran: CoveringRan, test: string, parts: readonly RanStand[], asked: readonly string[], now: number): string {
  const newest = [...parts].sort((one, other) => (other.landed?.latest ?? '').localeCompare(one.landed?.latest ?? ''));
  const oldest = newest.pop()!;
  const verb = ran.named === 'entered' ? 'that entered it' : ran.named === 'read' ? 'read here' : 'named here';
  const count = oldest.cases!.length;
  const said = [
    ...newest.map((part) => `${list(part.cases!.map((name) => `'${name}'`), 'other cases')}${partText(answer, part, asked, now)}`),
    `its ${String(count)} other case${count === 1 ? '' : 's'} ${verb}${partText(answer, oldest, asked, now)}`,
  ];
  return `${test} ran ${said.slice(0, -1).join(', ')}, and ${said.at(-1)!}.`;
}

/** What one part of a test file ran over and when, after its cases: ` over this text, in a run that landed 1 hour ago`. */
function partText(answer: Covering, part: RanStand, asked: readonly string[], now: number): string {
  const at = when([part], now);
  if (part.text === 'held') return ` over ${asked.length === 1 ? 'this text' : 'these texts'}, ${at}`;
  if (part.text === 'other') return ` over another text of ${list(part.other ?? asked, 'other files')}, ${at}${partRegion(answer, part)}`;
  if (part.unknown !== undefined) return ` over a text of ${list(asked, 'other files')} not known, ${at}, since ${part.unknown}`;
  return ` ${at}`;
}

/** The asked region of a part that ran another text, after its time: whether it is the same in both texts. */
function partRegion(answer: Covering, part: RanStand): string {
  const { region } = part;
  const { target } = answer;
  if (region === undefined || target === undefined) return '';
  const named = regionName(target);
  const many = 'lines' in target;
  if (region === 'same') return `, in which ${named} ${many ? 'are' : 'is'} the same`;
  if (region === 'changed') return `, in which ${named} ${many ? 'differ' : 'differs'}`;
  if (region === 'gone') return `, though ${named} is not in ${answer.file!} as it is now`;
  return `, in which whether ${named} ${many ? 'differ' : 'differs'} is not known, since ${region.unknown}`;
}

/** The files the answer asks about: the one file, or every changed one, off disk or not. */
function askedFiles(answer: Covering): readonly string[] {
  return answer.changed?.map((change) => change.file) ?? (answer.file === undefined ? [] : [answer.file]);
}

/** Who the answer names, as a noun phrase: `the 2 test files named here`, `the other test file named here`, `the test file read here`. */
function subject(ran: CoveringRan, count: number, others: boolean): string {
  const verb = ran.named === 'entered' ? 'that entered it' : ran.named === 'read' ? 'read here' : 'named here';
  const other = others ? 'other ' : '';
  return count === 1 ? `the ${other}test file ${verb}` : `the ${other}${String(count)} test files ${verb}`;
}

/** The asked region of a test file that ran another text, after a semicolon: whether it is the same in both texts. */
function regionText(answer: Covering, stand: RanStand): string {
  const { region } = stand;
  const { target } = answer;
  // A stand carries a region only when a line or a function is asked.
  if (region === undefined || target === undefined) return '';
  const named = regionName(target);
  const many = 'lines' in target;
  if (region === 'same') return `; ${named} ${many ? 'are' : 'is'} the same in both`;
  if (region === 'changed') return `; ${named} ${many ? 'differ' : 'differs'} between the two`;
  if (region === 'gone') return `; ${named} is not in ${answer.file!} as it is now`;
  return `; whether ${named} ${many ? 'differ' : 'differs'} is not known: ${region.unknown}`;
}

/** The asked line, run of lines or function, as a sentence names it. */
function regionName(target: CoveringTarget): string {
  if ('function' in target) return `\`${target.function}\``;
  if ('line' in target) return `line ${String(target.line)}`;
  return `lines ${String(target.lines.startLine)}-${String(target.lines.endLine)}`;
}

/** The earliest landing a group holds, as an ISO time; the empty string, which sorts first, when it holds none. */
function earliest(group: readonly RanStand[]): string {
  const times = group.flatMap((stand) => (stand.landed === undefined ? [] : [stand.landed.first]));
  return times.length < group.length || times.length === 0 ? '' : times.sort()[0]!;
}

/** The runs a stand's cases came from: the one that last finished its test files, and each that ran them in part since. */
function runsOf(stand: RanStand): readonly { readonly landed?: Landed }[] {
  return [stand, ...(stand.partly ?? [])];
}

/**
 * When a group's runs landed: `in a run that landed 5 minutes ago`, `in runs
 * that landed from 3 days ago to 5 minutes ago`, and what of it the record
 * holds no time for. A later run that ran a test file in part is one of its
 * runs. A record that holds no count still holds two landings when its first
 * and latest differ, so `runs` is said only of more than one.
 */
function when(group: readonly RanStand[], now: number): string {
  const runs = group.flatMap(runsOf);
  const landed = runs.flatMap((run): Landed[] => (run.landed === undefined ? [] : [run.landed]));
  const untimed = landed.length < runs.length;
  if (landed.length === 0) return 'at a time the record does not hold';
  const firstAt = landed.map((one) => one.first).sort()[0]!;
  const latestAt = landed.map((one) => one.latest).sort().at(-1)!;
  const counted = landed.every((one) => one.runs !== undefined) ? landed.reduce((sum, one) => sum + one.runs!, 0) : undefined;
  const many = counted === undefined ? firstAt !== latestAt : counted > 1;
  const first = ago(firstAt, now);
  const latest = ago(latestAt, now);
  const timed = many ? `in runs that landed ${first === latest ? latest : `from ${first} to ${latest}`}` : `in a run that landed ${latest}`;
  return untimed ? `${timed}, and at a time the record does not hold` : timed;
}

/** Up to five names, then how many more: `a, b and 3 other test files`. */
function list(names: readonly string[], more: string): string {
  const shown = names.length > 5 ? names.slice(0, 5) : names;
  const rest = names.length - shown.length;
  const all = rest === 0 ? shown : [...shown, `${String(rest)} ${rest === 1 ? more.replace(/s$/u, '') : more}`];
  return all.length === 1 ? all[0]! : `${all.slice(0, -1).join(', ')} and ${all.at(-1)!}`;
}

function capital(said: string): string {
  return `${said[0]!.toUpperCase()}${said.slice(1)}`;
}

/**
 * A time against `now`, floored to the unit a reader acts on: minutes in the
 * first hour, hours in the first two days, days after. A time later than `now`
 * is given as itself, since its age would be negative.
 */
function ago(iso: string, now: number): string {
  const age = now - Date.parse(iso);
  if (age < 0) return `at ${iso}, later than this machine's clock`;
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'under a minute ago';
  if (minutes < 60) return `${unit(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours < 48 ? unit(hours, 'hour') : unit(Math.floor(hours / 24), 'day')} ago`;
}

function unit(of: number, noun: string): string {
  return `${String(of)} ${noun}${of === 1 ? '' : 's'}`;
}
