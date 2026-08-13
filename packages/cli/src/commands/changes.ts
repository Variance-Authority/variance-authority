import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OperatorError } from '../exit.js';

/**
 * What `nx` and `turbo` already know, borrowed rather than recomputed.
 *
 * A file scan resolves specifiers, and it stops at the package boundary: in a
 * workspace, `@scope/design-system` resolves into that package's built output, and
 * built output is not what anybody edits. So a diff inside one package reaches
 * nothing in the package that consumes it, and every monorepo has exactly the
 * component library the boundary hides.
 *
 * Both of these tools compute precisely that missing edge, from the manifests, and
 * every repository that has one has already configured it. Asking is cheaper than
 * being right independently, and being right independently would mean shipping a
 * second workspace resolver whose answer must agree with theirs.
 *
 * ## They are a source of seeds, not a second selector
 *
 * Their answer is *which projects* a diff affects. A project is far coarser than a
 * subject — a one-line change to a leaf component marks the whole package affected
 * — so taking it as the selection would give back most of what selection is for.
 * It is taken as additional **changed input** instead: every file under an
 * affected project is treated as though the diff named it, and the file graph
 * narrows from there. The two answers union; neither overrules the other.
 *
 * Which is also why a failure here is fatal rather than empty. An empty project
 * list is a legitimate answer meaning *this diff crosses no package boundary*, so
 * a tool that failed and a tool that answered nothing must not be able to produce
 * the same value.
 */

export type ChangeTool = 'nx' | 'turbo';

export interface ChangeSource {
  readonly tool: ChangeTool;
  /**
   * The task to ask `turbo` about. Ignored by `nx`, which answers about projects
   * without being told a task.
   */
  readonly task?: string;
}

export interface AffectedProjects {
  readonly tool: ChangeTool;
  /** Project names, as the tool calls them. For the report, not for the graph. */
  readonly names: readonly string[];
  /** Repository-relative project roots. Every file under one counts as changed. */
  readonly dirs: readonly string[];
  /** One sentence naming what was asked and what it said. */
  readonly because: string;
}

const run = promisify(execFile);

/**
 * Ask the configured tool which projects a diff against `base` affects.
 *
 * The binary is looked up through the workspace's own `node_modules/.bin` before
 * the ambient path, so a repository pinning a version gets the version it pinned
 * rather than whatever a machine happens to have installed globally.
 */
export async function affectedProjects(input: {
  readonly source: ChangeSource;
  readonly base: string;
  readonly cwd: string;
}): Promise<AffectedProjects> {
  return input.source.tool === 'nx' ? fromNx(input) : fromTurbo(input);
}

async function fromNx(input: {
  readonly base: string;
  readonly cwd: string;
}): Promise<AffectedProjects> {
  const names = parseJson<readonly string[]>(
    await ask('nx', ['show', 'projects', '--affected', `--base=${input.base}`, '--json'], input),
    'nx show projects',
  );

  // One lookup per affected project, concurrently. `nx` answers with names and
  // the graph needs directories, and there is no single command that gives both.
  const dirs = await Promise.all(
    names.map(async (name) => {
      const project = parseJson<{ readonly root?: string }>(
        await ask('nx', ['show', 'project', name, '--json'], input),
        `nx show project ${name}`,
      );
      return project.root;
    }),
  );

  return {
    tool: 'nx',
    names: [...names].sort(byCodeUnit),
    dirs: cleaned(dirs),
    because: `\`nx show projects --affected --base=${input.base}\` named ${names.length} project(s)`,
  };
}

interface TurboDryRun {
  readonly packages?: readonly string[];
  readonly tasks?: readonly { readonly package?: string; readonly directory?: string }[];
}

async function fromTurbo(input: {
  readonly source: ChangeSource;
  readonly base: string;
  readonly cwd: string;
}): Promise<AffectedProjects> {
  const task = input.source.task;
  if (task === undefined) {
    throw new OperatorError(
      '`turbo` answers about a task rather than about a workspace, so `source.changes` needs a ' +
        '`task` alongside `tool: "turbo"` — the one your components are built by, usually ' +
        '`"build"`. Without it there is nothing to filter and the answer would be every package.',
    );
  }

  const dry = parseJson<TurboDryRun>(
    await ask('turbo', ['run', task, `--filter=...[${input.base}]`, '--dry=json'], input),
    `turbo run ${task} --dry=json`,
  );

  const names = [...(dry.packages ?? [])].sort(byCodeUnit);

  return {
    tool: 'turbo',
    names,
    dirs: cleaned((dry.tasks ?? []).map((entry) => entry.directory)),
    because:
      `\`turbo run ${task} --filter=...[${input.base}] --dry=json\` named ` +
      `${names.length} package(s)`,
  };
}

/**
 * Run the tool, or say so.
 *
 * Never an empty answer on failure. An empty project list means *this diff
 * crosses no package boundary*, and a run that answered a missing binary with it
 * would narrow itself past every consumer of the package that changed and report
 * success.
 */
async function ask(
  binary: string,
  args: readonly string[],
  input: { readonly cwd: string },
): Promise<string> {
  const path = process.env['PATH'] ?? '';

  try {
    const { stdout } = await run(binary, [...args], {
      cwd: input.cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PATH: `${input.cwd}/node_modules/.bin:${path}` },
    });
    return stdout;
  } catch (error) {
    throw new OperatorError(
      `\`${binary} ${args.join(' ')}\` failed: ${messageOf(error)}. Selection consumes this ` +
        'answer to find what a change reaches across package boundaries, and treating a failure ' +
        'as "no project affected" would skip every consumer of whatever changed. Check the tool ' +
        'is installed in this workspace and that the base ref exists.',
    );
  }
}

/**
 * The first JSON value in the output.
 *
 * Both tools print progress on stdout alongside their JSON, so the payload is
 * found rather than assumed to start at byte zero.
 */
function parseJson<T>(stdout: string, what: string): T {
  const start = Math.min(indexOr(stdout, '{'), indexOr(stdout, '['));
  const end = Math.max(stdout.lastIndexOf('}'), stdout.lastIndexOf(']'));

  if (start >= stdout.length || end < start) {
    throw new OperatorError(
      `\`${what}\` printed no JSON. Selection cannot read its answer, and guessing would mean ` +
        'narrowing a run on a value nobody produced.',
    );
  }

  try {
    return JSON.parse(stdout.slice(start, end + 1)) as T;
  } catch (error) {
    throw new OperatorError(`\`${what}\` printed JSON this could not read: ${messageOf(error)}`);
  }
}

function indexOr(value: string, mark: string): number {
  const at = value.indexOf(mark);
  return at === -1 ? value.length : at;
}

/** Present, non-empty, deduplicated, and in a stable order. */
function cleaned(dirs: readonly (string | undefined)[]): readonly string[] {
  const kept = dirs.filter((dir): dir is string => dir !== undefined && dir !== '' && dir !== '.');

  return [...new Set(kept.map((dir) => dir.replace(/\/+$/, '')))].sort(byCodeUnit);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
