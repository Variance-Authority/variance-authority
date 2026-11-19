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
import { started } from '../test-selection/job-recording.js';

/** `NODE_OPTIONS` flags that load both preloads, each path quoted. */
const PRELOAD = `--require ${JSON.stringify(fileURLToPath(new URL('./serve-fs.cjs', import.meta.url)))} --import ${JSON.stringify(new URL('./serve-modules.mjs', import.meta.url).href)}`;

/** A served run's exit, and each served file no process it started read. */
export interface ServedRun {
  exit: number;
  unread: string[];
}

/**
 * Run `command` in `cwd` with `files` — absolute path to the content it holds
 * for this run, or `null` for a file it does not see — served in every Node
 * process it starts. Undefined when there is no such command. An empty
 * manifest runs the command as it is, with no preload.
 */
export async function serveBase(files: Readonly<Record<string, string | null>>, command: readonly [string, ...string[]], cwd: string): Promise<ServedRun | undefined> {
  const [program, ...args] = command;
  if (Object.keys(files).length === 0) {
    const exit = await started(program, args, cwd);
    return exit === undefined ? undefined : { exit, unread: [] };
  }
  const scratch = await mkdtemp(join(tmpdir(), 'variance-janus-'));
  try {
    const manifest = join(scratch, 'manifest.json');
    const notes = join(scratch, 'reads');
    await writeFile(manifest, JSON.stringify(files));
    await mkdir(notes);
    const env = {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, PRELOAD].filter(Boolean).join(' '),
      VARIANCE_JANUS_MANIFEST: manifest,
      VARIANCE_JANUS_READS: notes,
    };
    const exit = await started(program, args, cwd, env);
    if (exit === undefined) return undefined;
    const read = new Set<string>();
    for (const note of await readdir(notes)) for (const file of (await readFile(join(notes, note), 'utf8')).split('\n')) if (file !== '') read.add(file);
    return { exit, unread: Object.keys(files).filter((file) => files[file] !== null && !read.has(file)) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
