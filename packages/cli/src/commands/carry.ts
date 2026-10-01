/**
 * What the host moves between jobs, named by the config and printed for the host.
 *
 * The config says where each artifact lives and who carries it (ADR-0077).
 * For `actions-cache`, the host moves the bytes, and this file answers the
 * three things `actions/cache` asks for: the paths, the key and the restore
 * keys. Before this, every workflow spelled those itself, as literals that
 * restated paths the config owns and a renderer the store already partitions
 * by. `share` is not answered here, because `variance share` moves those bytes
 * itself.
 *
 * A key is `variance-<artifact>:<line>:<commit>`, and a save appends the run
 * and its attempt, because an Actions cache key is never overwritten.
 * - `<artifact>` is `<project>-baselines`, `<project>-report` or
 *   `suite-<name>-<layer>`. Only a recording carries the layer, which is the
 *   digest of the checkout path its directory is keyed by: a recording
 *   restored to another path lands in a directory nobody reads. Baselines and
 *   reports hold no path, so they carry none.
 * - `<line>` is the branch a pull request targets, or the branch a push
 *   lands on. The colons around it are there because git refuses a colon in a
 *   ref name, so `main` never matches a key of `main-2`.
 *
 * Only a push to a mainline saves a recording. A pull request that saved its
 * own would restore it on its next push and review the change against itself.
 * The mainlines are asked of `share` (ADR-0077's order), and when nothing
 * answers, nothing is saved and the output says which answers were missing.
 */

// compass: variance-authority.retention

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  declaredSuites,
  repositoryLayers,
  repositoryRoot,
  type DeclaredSuite,
} from '@variance-authority/sense/test-selection';
import type { ParsedCarry } from '../carry-args.js';
import type { Mainlines } from '../share-lines.js';
import type { Config } from '../config.js';
import { loadConfig } from '../config-load.js';
import { EXIT_CLEAN, OperatorError, type ExitCode } from '../exit.js';

export type CarryDirection = 'restore' | 'save';

/**
 * Where a host run keeps `review`'s files, for the steps after it to upload
 * and comment with. `review` itself writes only where `--out` says, so this is
 * the path the workflow hands it rather than a default it assumes.
 */
export const REVIEW_OUT = '.variance/review';

/** What the host says about this run. Every field is absent off a host. */
export interface HostRun {
  readonly event?: string;
  readonly sha?: string;
  readonly ref?: string;
  readonly baseRef?: string;
  readonly run?: string;
  readonly attempt?: string;
  /** Where the change starts: see {@link baseOf}. */
  readonly base?: string;
}

/** One artifact the host cache moves: what `actions/cache` is handed. */
export interface Cached {
  /** `baselines`, `report`, or `suite-<name>`: the prefix of every output it prints. */
  readonly artifact: string;
  /** Paths, then the paths left out, as `actions/cache` spells them with `!`. */
  readonly paths: readonly string[];
  readonly key: string;
  /** Restore only: nearest first. */
  readonly restoreKeys?: readonly string[];
}

export interface CarryPlan {
  readonly direction: CarryDirection;
  /** The branch the keys are cut for. Absent off a host, where nothing is keyed. */
  readonly line?: string;
  readonly base?: string;
  readonly cached: readonly Cached[];
  /**
   * Where the baseline store sits on disk, for a host step that commits what an
   * accept wrote. Absent for a `remote` store and under ephemeral retention,
   * which keep nothing in the checkout.
   */
  readonly baselinesRoot?: string;
  /** What a reviewer downloads: uploaded as it is, so it has a path and no key. */
  readonly uploads: readonly { readonly name: string; readonly path: string }[];
  /**
   * The suites the config gives to the share, in the order the suites are
   * given: what a workflow reads and publishes a base record for, so it names
   * none.
   */
  readonly shared: readonly string[];
  /** What is carried and not printed, or not carried, and why: said, never silent. */
  readonly notes: readonly string[];
}

/** The host's answers, read from what GitHub Actions sets. */
export function hostRunOf(env: NodeJS.ProcessEnv): HostRun {
  const read = (name: string): string | undefined => (env[name] === undefined || env[name] === '' ? undefined : env[name]);
  const event = read('GITHUB_EVENT_NAME');
  const sha = read('GITHUB_SHA');
  const ref = read('GITHUB_REF');
  const baseRef = read('GITHUB_BASE_REF');
  const run = read('GITHUB_RUN_ID');
  const attempt = read('GITHUB_RUN_ATTEMPT');

  return {
    ...(event === undefined ? {} : { event }),
    ...(sha === undefined ? {} : { sha }),
    ...(ref === undefined ? {} : { ref }),
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(run === undefined ? {} : { run }),
    ...(attempt === undefined ? {} : { attempt }),
  };
}

const git = promisify(execFile);

/**
 * Where the change starts, asked of git.
 *
 * On a pull request the checkout is the merge of its head into the base, and
 * the merge's first parent is the base tip, so the change is the pull
 * request's own and not whatever the base gained since it branched. On a push
 * it is the commit the push replaced, which the event names; a push with none
 * (a new branch) or any other event starts one commit back.
 */
export async function baseOf(root: string, run: HostRun, eventPath: string | undefined): Promise<string | undefined> {
  if (run.event === 'push' && eventPath !== undefined) {
    const before = await pushedOver(eventPath);
    if (before !== undefined && (await commit(root, `${before}^{commit}`)) !== undefined) return before;
  }

  return commit(root, 'HEAD^1');
}

async function pushedOver(eventPath: string): Promise<string | undefined> {
  try {
    const before = (JSON.parse(await readFile(eventPath, 'utf8')) as { before?: unknown }).before;
    // A push that created the branch names forty zeroes, which is no commit.
    return typeof before === 'string' && /^[0-9a-f]{40,64}$/u.test(before) && !/^0+$/u.test(before) ? before : undefined;
  } catch {
    return undefined;
  }
}

async function commit(root: string, spec: string): Promise<string | undefined> {
  try {
    return (await git('git', ['rev-parse', '--verify', '--quiet', spec], { cwd: root })).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The branch a pull request targets, or the branch a push or a dispatch runs on. */
export function lineOf(run: HostRun): string | undefined {
  if (run.event === 'pull_request' || run.event === 'pull_request_target') return run.baseRef;
  return run.ref?.startsWith('refs/heads/') === true ? run.ref.slice('refs/heads/'.length) : undefined;
}

export interface CarryInput {
  readonly direction: CarryDirection;
  /** The checkout the recordings belong to. */
  readonly root: string;
  /** The project config, when one was named: the baselines and the report are its. */
  readonly config?: Config;
  /** The suites the repository root declares. */
  readonly suites?: readonly DeclaredSuite[];
  readonly run: HostRun;
  readonly mainlines: Mainlines;
}

/** What to carry, where it is, and under which keys. */
export function carryPlan(input: CarryInput): CarryPlan {
  const { direction, config, run } = input;
  const line = lineOf(run);
  const cached: Cached[] = [];
  const notes: string[] = [];
  const keyed = (artifact: string, paths: readonly string[], prefix: string, restoreFrom: string | undefined, fallback: readonly string[]): void => {
    if (line === undefined || run.sha === undefined) {
      notes.push(`${artifact} is carried by the host cache, and this is not a host run, so it has no key here`);
      return;
    }
    const at = `variance-${prefix}:${line}:`;
    if (direction === 'save') {
      if (run.run === undefined || run.attempt === undefined) {
        notes.push(`${artifact} is not saved: the host named no run to key it by`);
        return;
      }
      cached.push({ artifact, paths, key: `${at}${run.sha}-${run.run}-${run.attempt}` });
      return;
    }
    const from = restoreFrom ?? run.sha;
    cached.push({ artifact, paths, key: `${at}${from}`, restoreKeys: [`${at}${from}-`, at, ...fallback] });
  };

  if (config?.baselines?.kind === 'directory' && config.baselines.carry === 'actions-cache') {
    // Keyed by this commit, so a re-run of it finds what an accept in it saved,
    // then by the newest under the line.
    keyed('baselines', [config.baselines.root], `${config.project}-baselines`, undefined, []);
  }
  if (config?.reportCarry === 'actions-cache') {
    keyed('report', [config.report, config.images], `${config.project}-report`, undefined, []);
  }
  if (config?.reportCarry === 'share') notes.push('the report is carried by `variance share`');

  const top = repositoryLayers(input.root).top;
  for (const suite of input.suites ?? []) {
    if (suite.carry === 'share') notes.push(`suite ${suite.name} is carried by \`variance share\``);
    if (suite.carry !== 'actions-cache') continue;
    const artifact = `suite-${suite.name}`;
    if (direction === 'save' && !savesRecording(run, line, input.mainlines, artifact, notes)) continue;
    const prefix = `suite-${suite.name}-${basename(top)}`;
    const mainlines = 'names' in input.mainlines ? input.mainlines.names.filter((name) => name !== line) : [];
    keyed(
      artifact,
      [top, `!${top}/**/.run-*`, `!${top}/.work`],
      prefix,
      run.base,
      // Then the mainlines, for a line that saves none: a push to a branch
      // that is not one restores what a mainline recorded.
      mainlines.map((name) => `variance-${prefix}:${name}:`),
    );
  }

  const store = config?.baselines;
  return {
    direction,
    ...(line === undefined ? {} : { line }),
    ...(run.base === undefined ? {} : { base: run.base }),
    cached,
    ...(store === undefined || store.kind === 'remote' ? {} : { baselinesRoot: store.root }),
    uploads: [
      ...(config === undefined ? [] : [{ name: 'report', path: config.report }, { name: 'images', path: config.images }]),
      { name: 'review', path: resolve(input.root, REVIEW_OUT) },
    ],
    shared: (input.suites ?? []).filter((suite) => suite.carry === 'share').map((suite) => suite.name),
    notes,
  };
}

function savesRecording(run: HostRun, line: string | undefined, mainlines: Mainlines, artifact: string, notes: string[]): boolean {
  if ('missing' in mainlines) {
    notes.push(`${artifact} is not saved: no mainline is known, and these answers were missing: ${mainlines.missing.join(', ')}`);
    return false;
  }
  if (run.event !== 'push' || line === undefined || !mainlines.names.includes(line)) {
    notes.push(`${artifact} is not saved: only a push to a mainline (${mainlines.names.join(', ')}) saves a recording`);
    return false;
  }

  return true;
}

/**
 * The plan as `$GITHUB_OUTPUT` lines.
 *
 * `<artifact>-path`, `<artifact>-key` and, on a restore,
 * `<artifact>-restore-keys`, with the multi-line values in the heredoc form
 * the host reads; then `baselines-root` and the uploads, one path each. An artifact that is not carried this time prints nothing,
 * so a step guarded by `<artifact>-key != ''` does not run. Last, `shared-suites`:
 * the suites given to the share, separated by spaces, when there are any.
 */
export function githubOutput(plan: CarryPlan): string {
  const lines: string[] = [];
  const one = (name: string, value: string): void => {
    refuseNewline(value);
    lines.push(`${name}=${value}`);
  };
  const many = (name: string, values: readonly string[]): void => {
    values.forEach(refuseNewline);
    lines.push(`${name}<<${DELIMITER}`, ...values, DELIMITER);
  };
  if (plan.line !== undefined) one('line', plan.line);
  if (plan.base !== undefined) one('base', plan.base);
  for (const cached of plan.cached) {
    many(`${cached.artifact}-path`, cached.paths);
    one(`${cached.artifact}-key`, cached.key);
    if (cached.restoreKeys !== undefined) many(`${cached.artifact}-restore-keys`, cached.restoreKeys);
  }
  if (plan.baselinesRoot !== undefined) one('baselines-root', plan.baselinesRoot);
  for (const upload of plan.uploads) one(upload.name, upload.path);
  if (plan.shared.length > 0) {
    // Read by a shell loop, so a space in a name would split it into two suites.
    const spaced = plan.shared.find((name) => /\s/u.test(name));
    if (spaced !== undefined) throw new Error(`a shared suite's name holds a space, which shared-suites cannot carry: ${JSON.stringify(spaced)}`);
    one('shared-suites', plan.shared.join(' '));
  }

  return `${lines.join('\n')}\n`;
}

/** The plan as prose, for a person asking what CI would carry. */
export function carryText(plan: CarryPlan): string {
  const lines = [
    `carry ${plan.direction}${plan.line === undefined ? ', off a host run' : ` for ${plan.line}`}` +
      `${plan.base === undefined ? '' : `, from ${plan.base.slice(0, 12)}`}`,
  ];
  for (const cached of plan.cached) {
    lines.push('', `${cached.artifact}: ${cached.key}`, ...cached.paths.map((path) => `  ${path}`));
    if (cached.restoreKeys !== undefined) lines.push('  then', ...cached.restoreKeys.map((key) => `    ${key}`));
  }
  lines.push('');
  if (plan.baselinesRoot !== undefined) lines.push(`baselines: ${plan.baselinesRoot}`);
  lines.push(...plan.uploads.map((upload) => `${upload.name}: ${upload.path}`));
  if (plan.notes.length > 0) lines.push('', ...plan.notes);

  return `${lines.join('\n')}\n`;
}

/**
 * `variance carry`: read the config and the host, and print the plan.
 *
 * The mainlines are handed in rather than asked here, because the order they
 * are asked in is `share`'s (ADR-0077), and `carry` is one of its callers.
 * The notes go to the error stream under `--format github`, so a person
 * reading the log is told what was not carried while `$GITHUB_OUTPUT` gets only
 * outputs.
 */
export async function runCarry(
  parsed: ParsedCarry,
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
  mainlinesOf: (config: Config | undefined, env: NodeJS.ProcessEnv) => Promise<Mainlines>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExitCode> {
  const root = repositoryRoot(process.cwd());
  const config = parsed.config === undefined ? undefined : await loadConfig(parsed.config);
  let suites: readonly DeclaredSuite[] | undefined;
  try {
    suites = declaredSuites(root);
  } catch (error) {
    throw new OperatorError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  const host = hostRunOf(env);
  const base = await baseOf(root, host, env['GITHUB_EVENT_PATH']);
  const plan = carryPlan({
    direction: parsed.direction,
    root,
    ...(config === undefined ? {} : { config }),
    ...(suites === undefined ? {} : { suites }),
    run: base === undefined ? host : { ...host, base },
    mainlines: await mainlinesOf(config, env),
  });
  if (parsed.format === 'github') {
    streams.out(githubOutput(plan));
    if (plan.notes.length > 0) streams.err(`${plan.notes.join('\n')}\n`);
  } else {
    streams.out(carryText(plan));
  }

  return EXIT_CLEAN;
}

/**
 * The heredoc delimiter. Never a value: every path it closes is absolute and
 * every key begins `variance-`.
 */
const DELIMITER = 'VARIANCE_CARRY_END';

function refuseNewline(value: string): void {
  // `$GITHUB_OUTPUT` is read line by line, so a newline in a path would let a
  // file name write an output of its own.
  if (/[\r\n]/u.test(value)) throw new Error(`a carried path holds a line break, which $GITHUB_OUTPUT cannot carry: ${JSON.stringify(value)}`);
}
