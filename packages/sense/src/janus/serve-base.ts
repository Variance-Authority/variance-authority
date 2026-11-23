// compass: variance-authority.reach
/**
 * The run half of a `variance janus` run: start a command with a manifest of
 * base contents served under it, and answer which served files no process read.
 *
 * The manifest, the environment that names it and the notes each process
 * writes are this module's and `served.cts`'s alone; a caller hands over the
 * files and reads back the exit and the unread paths.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StdioOptions } from 'node:child_process';
import { started } from '../test-selection/job-recording.js';

/** `NODE_OPTIONS` flags that load both preloads, each path quoted. */
const PRELOAD = `--require ${JSON.stringify(fileURLToPath(new URL('./serve-fs.cjs', import.meta.url)))} --import ${JSON.stringify(new URL('./serve-modules.mjs', import.meta.url).href)}`;

/** A served run's exit, and each served file no process it started read. */
export interface ServedRun {
  exit: number;
  unread: string[];
}

/** A served run started with options, and whether it was stopped at its deadline rather than ended. */
export interface OptionedRun extends ServedRun {
  late: boolean;
}

/** What a served run starts with besides its files: the environment it adds to this one, where its streams go, and how many milliseconds it may run. */
interface ServedOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly stdio?: StdioOptions;
  readonly deadline?: number;
}

/**
 * Run `command` in `cwd` with `files` — the absolute path of a file the
 * checkout holds, to the base text it reads for this run — served in every
 * Node process it starts. Undefined when there is no such command.
 */
export function serveBase(files: Readonly<Record<string, string>>, command: readonly [string, ...string[]], cwd: string): Promise<ServedRun | undefined> {
  return servedRun(files, command, cwd).then((run) => (run === undefined ? undefined : { exit: run.exit, unread: run.unread }));
}

/** {@link serveBase}, started with `options` besides its files. */
export async function servedRun(files: Readonly<Record<string, string>>, command: readonly [string, ...string[]], cwd: string, { env: added = {}, stdio, deadline }: ServedOptions = {}): Promise<OptionedRun | undefined> {
  const [program, ...args] = command;
  const scratch = await mkdtemp(join(tmpdir(), 'variance-janus-'));
  try {
    const manifest = join(scratch, 'manifest.json');
    const notes = join(scratch, 'reads');
    await writeFile(manifest, JSON.stringify(files));
    await mkdir(notes);
    const env = {
      ...process.env,
      ...added,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, PRELOAD].filter(Boolean).join(' '),
      VARIANCE_JANUS_MANIFEST: manifest,
      VARIANCE_JANUS_READS: notes,
    };
    let late = false;
    const exit = await started(program, args, cwd, env, stdio, deadline === undefined ? undefined : { after: deadline, stopped: () => (late = true) });
    if (exit === undefined) return undefined;
    const read = new Set<string>();
    for (const note of await readdir(notes)) for (const file of (await readFile(join(notes, note), 'utf8')).split('\n')) if (file !== '') read.add(file);
    return { exit, unread: Object.keys(files).filter((file) => !read.has(file)), late };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
