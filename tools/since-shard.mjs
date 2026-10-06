/**
 * Which of a leg's files one CI job runs, when a slice is split across jobs.
 *
 * The placement is the one `variance run --shard` makes, called rather than
 * restated: `assign` in `packages/cli/src/commands/shard.ts`. A test file is a
 * group of one; with the durations the record carries, files go longest first
 * onto the least-loaded shard, and without them a checksum of the file decides.
 * Either way it is a function of the leg, the shard count and the durations, so
 * every job of a slice that reads the same record computes the same placement
 * without talking to the others, and their union is the leg. Jobs that each
 * fetch the mainline's record do not read the same one: the line moves when a
 * push to `main` publishes, so `check.yml` reads it once, in `base`, and hands
 * that read to every job.
 *
 * A shard's run records into a cache of its own (`--record-into`), so its
 * record holds that run alone. Folding shards is `variance journeys <shard.bin>…
 * --suite <name>`, which lays them over the base the way the runner lays one
 * run: a shard record that had the base seeded under it would carry the base
 * once per shard into the fold.
 */

import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { assign } from '../packages/cli/dist/commands/shard.js';
import { parseShard } from '../packages/cli/dist/shard-args.js';
import { suiteFiles } from './since-change.mjs';

/** The flags that take a value. */
export const MATRIX_FLAGS = ['--suite', '--shard', '--record-into'];

/** The value after `flag` in `argv`, `undefined` when the flag is absent, and `''` when nothing follows it. */
const valueOf = (argv, flag) => {
  const at = argv.indexOf(flag);
  return at < 0 ? undefined : (argv[at + 1] ?? '');
};

/**
 * The CI matrix's flags: one slice (`--suite`), this job's shard of every leg
 * (`--shard k/n`), a run that skips the reading (`--whole`), and a cache the run
 * records into alone (`--record-into`, absolute, as the cache root takes it).
 * `refused` is the sentence that says why they are not a request.
 */
export function matrixOf(argv) {
  const only = valueOf(argv, '--suite');
  const asked = valueOf(argv, '--shard');
  const shard = asked === undefined ? undefined : parseShard(asked);
  const into = valueOf(argv, '--record-into');
  const whole = argv.includes('--whole');
  if (only === '') return { refused: '`--suite` names no slice' };
  if (typeof shard === 'string') return { refused: shard };
  if (into !== undefined && !isAbsolute(into)) {
    return { refused: `\`--record-into ${into}\` must be an absolute directory: a relative one names no cache` };
  }
  return { only, shard, into, whole };
}

/**
 * The run of one slice's leg: every file in it, or this shard's part. No files
 * is the whole slice, which a shard lists to split. The reading was made from
 * this checkout's cache; only the run is pointed at `into`, through
 * `VARIANCE_AUTHORITY_CACHE`, the cache root every recording seam reads.
 */
export function runnerOf({ root, config, shard, into, say, durations }) {
  const env = into === undefined ? process.env : { ...process.env, VARIANCE_AUTHORITY_CACHE: into };
  const spawn = (files) =>
    spawnSync('yarn', ['vitest', 'run', '--config', config, ...files], { cwd: root, stdio: 'inherit', env }).status ?? 1;
  return (...files) => {
    if (shard === undefined) return spawn(files);
    const leg = files.length > 0 ? files : suiteFiles(root, config);
    const part = partOf(leg, shard, durations());
    say(`test:since: shard ${shard.index}/${shard.total} runs ${part.files.length} of the leg's ${leg.length} file(s), placed by ${part.by}.`);
    return part.files.length === 0 ? 0 : spawn(part.files);
  };
}

/**
 * This shard's part of `files`, longest first, and what placed it.
 *
 * `durations` maps a test file to the time the record says it took.
 */
function partOf(files, shard, durations) {
  const subjects = files.map((file) => ({ subject: { id: file }, declaredIn: file }));
  const known = new Map(files.flatMap((file) => (durations.has(file) ? [[file, durations.get(file)]] : [])));
  const { queue, by } = assign(subjects, shard, known.size === 0 ? undefined : known);
  return { files: queue.flat().map((index) => files[index]), by };
}
