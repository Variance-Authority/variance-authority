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

  /** A monorepo tool whose affected-project answer seeds the selection. */
  readonly changes?: ChangeConfig;
}

export interface ChangeConfig {
  readonly tool: 'nx' | 'turbo';

  /** The task whose affected set is asked for. Required by turbo. */
  readonly task?: string;
}

const CHANGE_TOOLS = ['nx', 'turbo'];

/**
 * Where components are declared, for selection only.
 *
 * Directories rather than globs, matching every other place this project asks
 * the same question: a glob syntax is a small language with its own bugs, and
 * *which directories hold components* is answerable without one.
 */
export function parseSource(value: unknown, options: ParseOptions): SourceConfig {
  const root = object(value, 'source', ['dirs', 'relations', 'changes'], options);
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

  return {
    dirs: dirs as readonly string[],
    ...(relations === undefined ? {} : { relations }),
    ...(root['changes'] === undefined ? {} : { changes: parseChanges(root['changes'], options) }),
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
