// compass: variance-authority.reach
/**
 * The tests a selection leaves to the mainline: those only the mainline's own
 * commits reach.
 *
 * A record behind `HEAD`'s merge base with the mainline is read against
 * everything since it, and that holds the commits a pull brought in as well as
 * the checkout's own change. A test is this checkout's to run when its outcome
 * here can differ from its outcome at the merge base, and the mainline's CI
 * answers for the merge base. So a test is kept when a reason that selected it
 * names a file the checkout changed from the merge base, or when the import
 * graph reaches it from one: the record was made before the mainline's change,
 * and that change may send a test somewhere it never went, so where the record
 * cannot say, the relations do. Where the relations stop at a string, the
 * declarations do: a precondition root that loads a changed file, or a changed
 * file nothing imports, which a config may name, keeps a test that declares a
 * root; a region in a file whose loads the scan could not all read keeps the
 * test it selected. A test none of these reach is the mainline's. ADR-0062
 * holds the rule, and the one load it cannot see.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { affectedBy, beforeReach, changedBefore, EDGE_KINDS, idOf, RUNTIME_EDGES, type NodeId, type Relations } from '@variance-authority/core/relate';
import type { ExecutionNarrowing, SelectionReason, TestDistance } from '@variance-authority/sense/test-selection';
import { ConfigError } from '../config-values.js';
import { readerMainline } from '../share-lines.js';
import { rootShare } from './mainline-base.js';

const run = promisify(execFile);

/** What {@link mainlineOwned} left of a narrowing, and the note that says what it left to the mainline. */
export interface Owned<Distance extends TestDistance> {
  readonly narrowing: ExecutionNarrowing;
  readonly distances: readonly Distance[] | undefined;
  readonly note?: string;
}

/** The files one reason names: where the change it read is, and every file it passed through to reach the test. */
function filesOf(reason: SelectionReason): readonly string[] {
  if (reason.kind === 'region') return [reason.file];
  if (reason.kind === 'precondition') return [reason.name];
  if (reason.kind === 'reader') return [reason.file, reason.reader];
  return reason.trail;
}

const LOADED = new Set(RUNTIME_EDGES.map((kind) => EDGE_KINDS.indexOf(kind)));
const DECLARED = EDGE_KINDS.indexOf('depends');

/** Whether anything in the graph loads the file `id`. */
function imported(relations: Relations, id: NodeId): boolean {
  const { offset, kind } = relations.dependents;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (LOADED.has(kind[edge]!)) return true;
  return false;
}

/** Whether the scan could not read every load out of `file`, and the file declares none with a `/// <depends>`: a change there may load anything. */
function computesLoads(relations: Relations, file: string): boolean {
  const id = idOf(relations, 'file', file);
  if (id === undefined || relations.unknown[id] !== 1) return false;
  const { offset, kind } = relations.depends;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (kind[edge] === DECLARED) return false;
  return true;
}

/** One git answer asked with `-z`, as paths; `undefined` when git fails. */
async function pathsOf(cwd: string, ...args: string[]): Promise<readonly string[] | undefined> {
  try {
    return (await run('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 })).stdout.split('\0').filter((path) => path !== '');
  } catch {
    return undefined;
  }
}

/** Whether `ancestor` is in the history of `commit`, and not `commit` itself. */
async function before(cwd: string, ancestor: string, commit: string): Promise<boolean> {
  if (ancestor === commit) return false;
  try {
    await run('git', ['merge-base', '--is-ancestor', ancestor, commit], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * `narrowing`, read from the record at `commit` in the checkout at `root`,
 * without the tests only the mainline's commits since `commit` reach. Nothing
 * is left out when the checkout names no mainline, git cannot name the merge
 * base or the files changed from it, or `commit` is not before that base.
 */
export async function mainlineOwned<Distance extends TestDistance>(
  root: string,
  commit: string,
  narrowing: ExecutionNarrowing,
  distances: readonly Distance[] | undefined,
  relations: Relations,
): Promise<Owned<Distance>> {
  const unchanged = { narrowing, distances };
  let share: ReturnType<typeof rootShare>;
  try {
    const selection = await import('@variance-authority/sense/test-selection');
    share = rootShare(selection.rootConfig(root));
  } catch (error) {
    if (error instanceof ConfigError) return unchanged;
    throw error;
  }
  if (share === undefined) return unchanged;
  const mainline = await readerMainline({ share }, process.env, root);
  const base = 'missing' in mainline ? undefined : mainline.base;
  if (base === undefined || !(await before(root, commit, base))) return unchanged;

  const [changed, untracked] = await Promise.all([
    pathsOf(root, 'diff', '--name-only', '-z', '--no-renames', base),
    pathsOf(root, 'ls-files', '-z', '--others', '--exclude-standard'),
  ]);
  if (changed === undefined || untracked === undefined) return unchanged;
  const mine = new Set([...changed, ...untracked]);
  const reached = new Set(affectedBy(relations, mine, { through: RUNTIME_EDGES }).files);
  const why = new Map((narrowing.because ?? []).map((cause) => [cause.test, cause.via] as const));
  // A config names its setup by a string, so a file of mine nothing imports may be one a precondition the mainline changed now names.
  const named = [...mine].some((file) => {
    const id = idOf(relations, 'file', file);
    return id !== undefined && !narrowing.entered.includes(file) && !imported(relations, id);
  });
  const ours = (test: string): boolean => {
    const via = why.get(test);
    // A test selected for no reason it names is kept: nothing says whose change selected it.
    if (via === undefined || via.length === 0) return true;
    if (reached.has(test) || via.some((reason) => filesOf(reason).some((file) => mine.has(file)))) return true;
    const roots = via.flatMap((reason) => (reason.kind === 'precondition' ? [reason.name] : []));
    if (roots.length > 0 && (named || changedBefore(beforeReach(relations, roots), [...mine]).length > 0)) return true;
    return via.some((reason) => reason.kind === 'region' && computesLoads(relations, reason.file));
  };
  const left = narrowing.entered.filter((test) => !ours(test));
  if (left.length === 0) return unchanged;
  const kept = new Set(narrowing.entered.filter(ours));
  const name = 'missing' in mainline ? '' : mainline.name;
  return {
    narrowing: { ...narrowing, entered: [...kept], because: (narrowing.because ?? []).filter((cause) => kept.has(cause.test)) },
    distances: distances?.filter((distance) => kept.has(distance.test)),
    note:
      `${left.length} test file(s) left to mainline ${name}: only its commits between the record's commit ` +
      `${commit.slice(0, 12)} and the merge base ${base.slice(0, 12)} reach them, and nothing this checkout changed from that base does`,
  };
}
