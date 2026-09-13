/**
 * Where components are declared, and who else gets asked what a diff affects.
 *
 * The one part of the config that decides *what is observed* rather than what
 * observing means. Everything under `source` is read by the selector before a
 * browser opens, and every setting in it is arranged so that a wrong or missing
 * value widens a run rather than narrowing it
 * ([`docs/selecting.md`](../../../docs/selecting.md)).
 */

import { ConfigError, object, type ParseOptions } from './config-values.js';

export interface SourceConfig {
  /** Directories your components are declared in. */
  readonly dirs: readonly string[];

  /**
   * Read what imports what, and select by that instead of by declaration alone.
   *
   * The rule this replaces is the expensive one: without a graph, a changed file
   * that declares no component could have moved anything, so it moves everything
   * — which is every token file, every theme, every hook. With a graph the same
   * file is answered exactly, by walking from it to the components that rest on
   * it ([`docs/selecting.md`](../../../docs/selecting.md)).
   *
   * Off by default because it costs a parse of the source tree, and because the
   * selector's answer is only as good as the graph: a repository the scan cannot
   * read widens rather than narrows, which is safe and is not free.
   */
  readonly relations?: boolean;

  /**
   * What a change reaching only components no baseline records should do.
   *
   * `narrow` — the default — rules those subjects out, and names the components
   * it could not match. A suite watches less than it builds, and a change landing
   * outside what it watches is the ordinary reason to run nothing.
   *
   * `whole` is the operator declaring that their subjects render those components
   * without recording them, and the run observes everything rather than reporting
   * success over them. A server component is in no client fiber tree and is
   * always that; for now, so is anything outside the browser
   * ([`docs/selecting.md`](../../../docs/selecting.md)).
   */
  readonly unrendered?: 'whole' | 'narrow';

  /** A monorepo tool whose affected-project answer seeds the selection. */
  readonly changes?: ChangeConfig;

  /**
   * Tables of what a file imports beyond, or short of, what its text says,
   * as JSON files relative to the config
   * ([`sense/taint`](../../sense/src/taint/index.ts)).
   *
   * One table is read without being named: the mocks. A test that calls
   * `vi.mock('./api')` imports `./api` by the letter and runs none of it, and a
   * graph that believed the letter would select that test for every change to
   * the module it replaced. The mock reader runs whenever `relations` does,
   * over the test, story and setup files only, and a table here adds what no
   * reader can see — a framework's own import notation, a module loaded by a
   * name the code never writes.
   */
  readonly taints?: readonly string[];
}

export interface ChangeConfig {
  readonly tool: 'nx' | 'turbo';

  /** The task whose affected set is asked for. Required by turbo. */
  readonly task?: string;
}

const CHANGE_TOOLS = ['nx', 'turbo'];
const UNRENDERED = ['whole', 'narrow'];

/**
 * Where components are declared, for selection only.
 *
 * Directories rather than globs, matching every other place this project asks
 * the same question: a glob syntax is a small language with its own bugs, and
 * *which directories hold components* is answerable without one.
 */
export function parseSource(value: unknown, options: ParseOptions): SourceConfig {
  const root = object(value, 'source', ['dirs', 'relations', 'unrendered', 'changes', 'taints'], options);
  const dirs = root['dirs'];

  if (!Array.isArray(dirs) || dirs.length === 0 || dirs.some((dir) => typeof dir !== 'string')) {
    throw new ConfigError(
      options.source,
      'source.dirs',
      'must be a non-empty array of directory paths; selection narrows a run by what these ' +
        'declare, so an empty list would silently narrow it to nothing',
    );
  }

  const relations = root['relations'];
  if (relations !== undefined && typeof relations !== 'boolean') {
    throw new ConfigError(options.source, 'source.relations', 'must be true or false');
  }

  const taints = root['taints'];
  if (taints !== undefined && (!Array.isArray(taints) || taints.some((file) => typeof file !== 'string'))) {
    throw new ConfigError(
      options.source,
      'source.taints',
      'must be an array of paths to JSON taint tables, each keyed by file with `-` and `+` rows',
    );
  }

  const unrendered = root['unrendered'];
  if (unrendered !== undefined && (typeof unrendered !== 'string' || !UNRENDERED.includes(unrendered))) {
    throw new ConfigError(
      options.source,
      'source.unrendered',
      `must be one of ${UNRENDERED.join(', ')} — what a change reaching only components no ` +
        'baseline records should do',
    );
  }

  return {
    dirs: dirs as readonly string[],
    ...(relations === undefined ? {} : { relations }),
    ...(unrendered === undefined ? {} : { unrendered: unrendered as NonNullable<SourceConfig['unrendered']> }),
    ...(root['changes'] === undefined ? {} : { changes: parseChanges(root['changes'], options) }),
    ...(taints === undefined ? {} : { taints: taints as readonly string[] }),
  };
}

/**
 * The monorepo tool whose affected-project answer this run may use.
 *
 * Read as *seeds*, never as the selection. Both tools answer at the granularity
 * of a project, and a project is hundreds of components; taken as an answer it
 * would observe every subject in a package because one file in it moved. Taken
 * as a seed set, the file graph narrows it the same way it narrows a diff, and
 * what the tools contribute is the half the scan cannot see — a dependency that
 * only exists through built output.
 */
function parseChanges(value: unknown, options: ParseOptions): ChangeConfig {
  const root = object(value, 'source.changes', ['tool', 'task'], options);
  const tool = root['tool'];
  const task = root['task'];

  if (typeof tool !== 'string' || !CHANGE_TOOLS.includes(tool)) {
    throw new ConfigError(
      options.source,
      'source.changes.tool',
      `must be one of ${CHANGE_TOOLS.join(', ')}`,
    );
  }

  if (task !== undefined && (typeof task !== 'string' || task === '')) {
    throw new ConfigError(options.source, 'source.changes.task', 'must be a non-empty string');
  }

  // `turbo` has no way to ask which projects changed without naming a task —
  // its filter answers *what would run*. Demanding the name here rather than
  // inventing `build` keeps a run from narrowing by a pipeline nobody chose.
  if (tool === 'turbo' && task === undefined) {
    throw new ConfigError(
      options.source,
      'source.changes.task',
      'is required for turbo, whose affected answer is scoped to a task; name the one whose ' +
        'inputs match what a render depends on (often `build`)',
    );
  }

  return { tool: tool as ChangeConfig['tool'], ...(task === undefined ? {} : { task }) };
}
