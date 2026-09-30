import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ShareLine, ShareMiss } from '@variance-authority/core/share';
import type { RunReport } from '@variance-authority/report';
import type { Config } from '../config.js';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { readReportEntry, REPORT_ENTRY } from '../share-entries.js';
import { headPast, lineOfReader } from '../share-lines.js';
import { AbsentReport } from './report-read.js';
import { sharedReportRoot } from './resources.js';
import { readCliRunReport, type CliRunReport } from './run.js';
import { describeDistance, describeMiss, lineEntry, mainlineEntry, type Here, type LineEntry } from './share.js';

/**
 * The report a reader answers from when this checkout has none of its own
 * (ADR-0077).
 *
 * `config.report` first, always, and fetching nothing when it is there. Without
 * it, the branch's own line, then the mainline's. A record read from a line is
 * kept under the cache by its entry digest and never at `config.report`: that
 * path is where this checkout's own run writes, and CI's record put there would
 * be read back as a run made here.
 *
 * Under the digest the record keeps the checkout's layout: it sits at the
 * configured report's path relative to the repository, so every image path the
 * report names resolves to the same place under the digest as it does in a
 * checkout — an image directory beside the report's directory included.
 *
 * Every answer from a line carries {@link SharedReport.says}: the line, the
 * commit it was evaluated at and how it stands to `HEAD`. A branch record whose
 * commit `HEAD` does not contain is said to be another run of the branch,
 * because a record of a commit you rebased away describes code you no longer
 * have.
 */

/** A report read from a line, where it is kept, and the sentence every answer from it carries. */
export interface SharedReport {
  /**
   * `<cache>/report/<entry digest>/` and the configured report's path relative
   * to the repository, or `run.json` there when the configured report is
   * outside the repository.
   */
  readonly path: string;
  /** `<cache>/report/<entry digest>`: nothing kept for this entry is written outside it. */
  readonly entryDir: string;
  readonly line: ShareLine;
  readonly commit: string;
  readonly head?: string;
  /** The entry's image table: each path the report names, to its digest. */
  readonly images: Readonly<Record<string, string>>;
  readonly image: (digest: string) => Promise<Uint8Array | ShareMiss>;
  readonly says: string;
}

/** The configured report when it is on disk, or the one a line holds. */
export async function reportSource(config: Config, here: Here = {}): Promise<{ readonly local: string } | SharedReport> {
  try {
    await stat(config.report);
    return { local: config.report };
  } catch (error) {
    // Only absence falls through. A report this process may not open is still
    // this checkout's report, and reading it says why it cannot be read.
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') return { local: config.report };
  }
  return sharedReport(config, here);
}

/**
 * The report the branch's line holds, else the mainline's, or a refusal that
 * names each line asked and why it did not answer.
 */
export async function sharedReport(config: Config, here: Here = {}): Promise<SharedReport> {
  const absent = `there is no run report at ${config.report}, which is where \`report\` in your configuration points`;
  if (config.share === undefined) {
    throw new OperatorError(`${absent}; \`variance run\` writes it there, and no share is configured to read CI's from`);
  }
  const env = here.env ?? process.env;
  const cwd = here.cwd ?? process.cwd();
  const asked: string[] = [];

  const branch = await lineOfReader(config, env, cwd);
  if ('line' in branch) {
    const found = await lineEntry(config, branch.line, REPORT_ENTRY, cwd);
    const kept = 'miss' in found ? describeMiss(found.miss, found.holds) : await keep(config, found);
    if (typeof kept === 'string') asked.push(`branch ${branch.line.name}: ${kept}`);
    else {
      const says = `report: read from branch ${branch.line.name}, ${await standing(kept.entry, branch.line.name, cwd)}; kept at ${kept.path}.`;
      const { path, entryDir, images, image, entry } = kept;
      return { path, entryDir, images, image, line: branch.line, commit: entry.commit, ...headOf(entry), says };
    }
  } else asked.push(`branch: not asked, because ${branch.none}`);

  const main = await mainlineEntry(config, REPORT_ENTRY, { env, cwd });
  if ('miss' in main) {
    const line = main.mainline === undefined ? 'no mainline' : `mainline ${main.mainline}`;
    asked.push(`${line}: ${describeMiss(main.miss, main.holds)}`);
  } else {
    const line = `mainline ${main.at.mainline}`;
    const kept = await keep(config, main.held);
    if (typeof kept === 'string') asked.push(`${line}: ${kept}`);
    else {
      // A branch that was asked and did not answer is said too: a refusal
      // there is a credential to fix, and an answer from the mainline alone
      // would hide it.
      const says = [
        `report: read from ${line}, evaluated at ${main.at.commit}, ${describeDistance(main.at.distance)}; kept at ${kept.path}.`,
        ...asked.filter((one) => one.startsWith('branch ')).map((one) => `${one}.`),
      ];
      const at = { kind: 'mainline', name: main.at.mainline } as const;
      const { path, entryDir, images, image } = kept;
      return { path, entryDir, images, image, line: at, commit: main.at.commit, says: says.join('\n') };
    }
  }
  throw new OperatorError(`${absent}, and the share holds none for this checkout:\n${asked.map((one) => `  ${one}`).join('\n')}`);
}

/** A report for `ask`: where it was read, and what to say about it when it came from a line. */
export interface Reading {
  readonly report: RunReport;
  /** The file read; `ask` records the subject it answered beside it. */
  readonly path: string;
  readonly says?: string;
}

/**
 * The report `ask` answers from: what `read` returns, or, when that is the
 * configured report and it is absent, the one a line holds.
 *
 * A reader who named shard paths is answered from those or refused: they said
 * which run they meant. The subjects a question names have their images
 * fetched beside the kept report, so a path the answer prints opens.
 */
export async function readingFor(
  request: { readonly report: string; readonly read: () => Promise<RunReport>; readonly here?: Here },
  input: Readonly<Record<string, unknown>>,
): Promise<Reading> {
  let config: Config;
  try {
    return { report: await request.read(), path: request.report };
  } catch (error) {
    if (!(error instanceof AbsentReport)) throw error;
    config = error.config;
  }
  const source = await sharedReport(config, request.here);
  const report = await readCliRunReport(source.path);
  const named = [input['subject'], ...(Array.isArray(input['subjects']) ? input['subjects'] : [])];
  const failed = await openImages(source, report, named.filter((one): one is string => typeof one === 'string'));
  return { report, path: source.path, says: [source.says, ...failed].join('\n') };
}

/**
 * Fetch, by digest, each image the named subjects' observations point at, to
 * the path the report names it by. Returns a line for each image that could
 * not be fetched, and nothing for one that was.
 *
 * One subject at a time rather than the whole report, because an image is
 * what a line holds most of and a reader opens the few an answer names. A
 * path is resolved against the kept report, as a checkout resolves it, and one
 * that would land outside {@link SharedReport.entryDir} is not written: the
 * table came from whoever could write the line.
 */
export async function openImages(source: SharedReport, report: CliRunReport, subjects: readonly string[]): Promise<readonly string[]> {
  const dir = dirname(source.path);
  const failed: string[] = [];
  for (const observation of report.observations) {
    if (!subjects.includes(observation.subject)) continue;
    for (const named of Object.values(observation.images ?? {})) {
      if (named === undefined) continue;
      const target = resolve(dir, named);
      const digest = source.images[named];
      const why =
        leaves(relative(source.entryDir, target)) ? `it names a path outside ${source.entryDir}, so it is not fetched`
        : digest === undefined ? 'it was not published with the report'
        : await fetched(source, digest, target);
      if (why !== undefined) failed.push(`image ${named}: ${why}.`);
    }
  }
  return failed;
}

async function fetched(source: SharedReport, digest: string, target: string): Promise<string | undefined> {
  if (await stat(target).then(() => true, () => false)) return undefined;
  const bytes = await source.image(digest);
  if (!(bytes instanceof Uint8Array)) return describeMiss(bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== digest) return 'the bytes the line holds do not match their digest';
  return settle(target, bytes);
}

function headOf(entry: { readonly head?: string }): { readonly head?: string } {
  return entry.head === undefined ? {} : { head: entry.head };
}

/** Where a branch record stands to `HEAD`: in this checkout's history, or another run of the branch. */
async function standing(entry: { readonly commit: string; readonly head?: string }, branch: string, cwd: string): Promise<string> {
  const at = `evaluated at ${entry.commit}${entry.head === undefined ? '' : ` for pull request head ${entry.head}`}`;
  const tried = [entry.head, entry.commit].filter((one): one is string => one !== undefined);
  let past: number | false | undefined;
  for (const commit of tried) {
    const answer = await headPast(commit, cwd);
    if (typeof answer === 'number') return `${at}, ${answer === 0 ? 'which is HEAD' : `${String(answer)} commit(s) before HEAD`}`;
    past = past === false ? false : answer;
  }
  return past === false
    ? `${at}, which this checkout does not contain: another run of ${branch}, not this checkout's`
    : `${at}, which this clone does not hold: read as another run of ${branch}, not this checkout's`;
}

/**
 * Whether a relative path leaves the directory it is relative to: `..` as a
 * segment, or a path on another root. A name that only begins with two dots,
 * such as `..a.png`, stays inside.
 */
function leaves(path: string): boolean {
  return isAbsolute(path) || path.split(sep).includes('..');
}

/**
 * Where under its entry's directory the record is kept: the configured
 * report's path relative to the repository this checkout is in, so the
 * checkout's layout is repeated under the digest. A configured report outside
 * that repository has no such path, and is kept as `run.json`.
 *
 * Git names the repository, asked from the report's nearest directory that
 * exists, because the report's own directory need not exist yet in a checkout
 * that has never run. Asking from the report rather than from where the
 * command runs keeps one record at one path, whichever directory you ask
 * from. Both paths are compared as the filesystem spells them, so a checkout
 * reached through a symbolic link is not taken for a report outside it.
 */
async function keptName(report: string): Promise<string> {
  const top = await checkoutOf(await existing(dirname(resolve(report))));
  const inside = top === undefined ? '' : relative(await spelled(top), await spelled(report));
  return inside === '' || leaves(inside) ? 'run.json' : inside;
}

/** The top of the checkout `dir` sits in, or undefined when git names none. */
function checkoutOf(dir: string): Promise<string | undefined> {
  return new Promise((done) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd: dir }, (error, stdout) =>
      done(error === null && stdout.trim() !== '' ? stdout.trim() : undefined),
    );
  });
}

/** The nearest directory at or above `path` that exists. */
async function existing(path: string): Promise<string> {
  for (let at = path; ; at = dirname(at)) {
    if (await stat(at).then((held) => held.isDirectory(), () => false)) return at;
    if (dirname(at) === at) return at;
  }
}

/** `path` with its nearest existing ancestor spelled by `realpath`, and the rest as given. */
async function spelled(path: string): Promise<string> {
  const rest: string[] = [];
  for (let at = resolve(path); ; at = dirname(at)) {
    const real = await realpath(at).catch(() => undefined);
    if (real !== undefined) return join(real, ...rest.reverse());
    if (dirname(at) === at) return resolve(path);
    rest.push(basename(at));
  }
}

/**
 * The entry's report under `<cache>/report/<digest>/`, its image table at
 * `<cache>/report/<digest>.images.json`, or why they could not be read. The
 * digest is the manifest's, so a second read of the same entry opens the kept
 * files and fetches nothing.
 *
 * The table sits beside the digest's directory rather than in it, because
 * that directory repeats the checkout's layout and any name in it can be a
 * path the report or its images use.
 */
async function keep(
  config: Config,
  found: LineEntry,
): Promise<(Pick<SharedReport, 'path' | 'entryDir' | 'images' | 'image'> & { readonly entry: LineEntry['entry'] }) | string> {
  const entryDir = join(sharedReportRoot(config), found.entry.digest);
  const path = join(entryDir, await keptName(config.report));
  const tabled = `${entryDir}.images.json`;
  const kept = { path, entryDir, entry: found.entry, image: found.image };
  const held = await readFile(tabled, 'utf8')
    .then(async (text) => (await stat(path), JSON.parse(text) as Record<string, string>))
    .catch(() => undefined);
  if (held !== undefined) return { ...kept, images: held };

  const bytes = await found.bytes();
  if (!(bytes instanceof Uint8Array)) return describeMiss(bytes);
  const parts = readReportEntry(bytes);
  if (typeof parts === 'string') return parts;
  // The table before the report: a kept report is a complete entry.
  const failed = (await settle(tabled, new TextEncoder().encode(JSON.stringify(parts.images)))) ?? (await settle(path, parts.report));
  return failed ?? { ...kept, images: parts.images };
}

/** Write through a temporary file and a rename, so a reader never opens half of one. */
async function settle(path: string, bytes: Uint8Array): Promise<string | undefined> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${String(process.pid)}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
    return undefined;
  } catch (error) {
    return `it could not be kept at ${path}: ${messageOf(error)}`;
  }
}
