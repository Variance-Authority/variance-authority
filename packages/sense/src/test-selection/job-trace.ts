// compass: variance-authority.reach
/**
 * What a job touched, read off a system-call trace.
 *
 * A job is whatever its command starts, in any language, so what it read is
 * asked of the kernel rather than of a runtime. The trace is `strace -f -y`
 * output in one file, which keeps every process's calls in the order they
 * happened: that order is what tells an input from an output, since a file the
 * job wrote before reading is one it made.
 *
 * Two answers, both absolute paths as the kernel resolved them:
 *
 * - `reads`: opened for reading, run, or moved away, before the job wrote it. A
 *   write that keeps what was there, an append, is a read of it too.
 * - `writes`: opened for writing, created, truncated, or landed on by a rename
 *   or a link. A file read first is in both.
 *
 * A relative path on a call with no directory, and a line that is no call, say
 * nothing that can be placed, and are left out. A script started by a relative
 * path is still read, through the open its interpreter makes.
 */

import { posix } from 'node:path';

/** What one traced command touched, as paths the recorder resolved. */
export interface JobTrace {
  readonly reads: ReadonlySet<string>;
  readonly writes: ReadonlySet<string>;
}

/** The calls the recorder traces, as `strace -e trace=` takes them. */
export const TRACED_CALLS: readonly string[] = [
  'open', 'openat', 'openat2', 'creat', 'execve', 'truncate',
  'rename', 'renameat', 'renameat2', 'link', 'linkat',
];

/** The calls that move or copy a name, by whether each path follows its directory. */
const MOVES: ReadonlyMap<string, { readonly at: boolean; readonly away: boolean }> = new Map([
  ['rename', { at: false, away: true }],
  ['renameat', { at: true, away: true }],
  ['renameat2', { at: true, away: true }],
  ['link', { at: false, away: false }],
  ['linkat', { at: true, away: false }],
]);

/** The ordered calls of `lines`, answered as {@link JobTrace}. */
export function readJobTrace(lines: Iterable<string>): JobTrace {
  const reads = new Set<string>();
  const writes = new Set<string>();
  // What the job has made so far: a read of one of these is a read of its own output.
  const made = new Set<string>();
  const split = new Map<string, string>();

  const read = (path: string | undefined): void => {
    if (path !== undefined && !made.has(path)) reads.add(path);
  };
  const write = (path: string | undefined): void => {
    if (path === undefined) return;
    writes.add(path);
    made.add(path);
  };

  for (const line of lines) {
    const call = joined(line, split);
    if (call === undefined) continue;
    const { name, args, result } = call;
    const failed = result.startsWith('-1');

    const move = MOVES.get(name);
    if (move !== undefined) {
      if (failed) continue;
      const [from, to] = move.at ? [pathOf(args[1], args[0]), pathOf(args[3], args[2])] : [pathOf(args[0]), pathOf(args[1])];
      read(from);
      if (from !== undefined && move.away) {
        writes.add(from);
        made.delete(from);
      }
      write(to);
      continue;
    }

    if (name === 'execve') {
      if (!failed) read(pathOf(args[0]));
    } else if (name === 'truncate' || name === 'creat') {
      if (!failed) write(pathOf(args[0]));
    } else if (name === 'open' || name === 'openat' || name === 'openat2') {
      const at = name !== 'open';
      const flags = args[at ? 2 : 1] ?? '';
      const asked = at ? pathOf(args[1], args[0]) : pathOf(args[0]);
      // A descriptor opened by `O_PATH` only names the file: nothing of it was read.
      if (failed || /O_PATH/.test(flags)) continue;
      const path = annotated(result) ?? asked;
      // Only a write that empties the file owes nothing to what was there.
      if (!/O_WRONLY/.test(flags) || !/O_TRUNC/.test(flags)) read(path);
      if (/O_WRONLY|O_RDWR/.test(flags)) write(path);
    }
  }
  return { reads: sorted(reads), writes: sorted(writes) };
}

const sorted = (paths: ReadonlySet<string>): ReadonlySet<string> => new Set([...paths].sort());

interface Call {
  readonly name: string;
  readonly args: readonly string[];
  readonly result: string;
}

/** The whole call on `line`, once a call split across lines has both its halves. */
function joined(line: string, split: Map<string, string>): Call | undefined {
  const parts = /^(\d+)\s+(.*)$/.exec(line);
  if (parts === null) return undefined;
  const [, pid, text] = parts as unknown as [string, string, string];
  if (text.endsWith('<unfinished ...>')) {
    split.set(pid, text.slice(0, -'<unfinished ...>'.length).trimEnd());
    return undefined;
  }
  const resumed = /^<\.\.\. \w+ resumed>(.*)$/.exec(text);
  if (resumed === null) return parsed(text);
  const start = split.get(pid);
  split.delete(pid);
  return start === undefined ? undefined : parsed(`${start}${resumed[1]!}`);
}

/** A call's name, its top-level arguments as written, and what follows ` = `. */
function parsed(text: string): Call | undefined {
  const open = text.indexOf('(');
  if (open <= 0 || !/^\w+$/.test(text.slice(0, open))) return undefined;
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let index = start;
  for (; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') index = closingQuote(text, index);
    else if (char === '<') index = Math.max(index, text.indexOf('>', index));
    else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
    else if (char === ')' && depth > 0) depth -= 1;
    else if (char === ')') break;
    else if (char === ',' && depth === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (index >= text.length) return undefined;
  args.push(text.slice(start, index).trim());
  const equals = text.indexOf('= ', index);
  return equals === -1 ? undefined : { name: text.slice(0, open), args, result: text.slice(equals + 2) };
}

function closingQuote(text: string, from: number): number {
  for (let index = from + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '"') return index;
  }
  return text.length;
}

/** The absolute path `arg` names, from `directory` when it is relative. */
function pathOf(arg: string | undefined, directory?: string): string | undefined {
  if (arg === undefined || !arg.startsWith('"')) return undefined;
  const path = decoded(arg.slice(1, closingQuote(arg, 0)));
  if (path.startsWith('/')) return posix.normalize(path);
  const base = directory === undefined ? undefined : annotated(directory);
  return base === undefined || path === '' ? undefined : posix.normalize(`${base}/${path}`);
}

/** The path `-y` printed after a descriptor, as `3</r/a.txt>`. */
function annotated(text: string): string | undefined {
  const match = /^[^<]*<(.*)>$/.exec(text);
  return match === null ? undefined : decoded(match[1]!);
}

const ESCAPES: Readonly<Record<string, number>> = { n: 10, t: 9, r: 13, v: 11, f: 12 };

/** A path as strace escapes it: bytes in octal, read back as UTF-8. */
function decoded(text: string): string {
  const bytes: number[] = [];
  const source = Buffer.from(text, 'utf8');
  for (let index = 0; index < source.length; index += 1) {
    const byte = source[index]!;
    if (byte !== 0x5c) {
      bytes.push(byte);
      continue;
    }
    const rest = source.subarray(index + 1, index + 4).toString('latin1');
    const octal = /^[0-7]{1,3}/.exec(rest)?.[0];
    if (octal !== undefined) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
    } else {
      bytes.push(ESCAPES[rest[0]!] ?? source[index + 1]!);
      index += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
