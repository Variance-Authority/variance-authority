// compass: variance-authority.reach

/**
 * The selection an Rstest run reads, applied inside the process: the files it
 * skips join the project's `exclude`, so Rstest never plans them, and no path
 * crosses the command line.
 *
 * Rstest hands its Rsbuild plugins `modifyRstestConfig`, whose callbacks it
 * awaits and then plans the project's entries again. The selection is read
 * there, once the command line is merged in, and against the files the
 * project's own `include` and `exclude` find. Files named on the command line
 * are not counted apart: `M` is the project's files, as under Jest.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { glob, isDynamicPattern } from 'tinyglobby';
import { kept, selectedLines, type SuiteSelection } from './suite-selection.js';
import { askedSelection } from './selection-environment.js';
import { projectPath } from './instrumented-modules.js';

/** Where the plugins read the command line and the environment, and say why they do not select. */
interface SelectingContext {
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly say?: (line: string) => void;
}

/** One read per run: each project of a `projects` configuration asks for the same selection. */
const reads = new Map<string, Promise<SuiteSelection>>();

/**
 * The plugins that apply the selection a run is handed, or else the one
 * `VARIANCE_AUTHORITY_SINCE` asks for: none when it asks for none, and every
 * file runs. Watch mode does not select: a file left out when Rstest first
 * plans would stay out for the session, whatever a later edit reaches.
 */
export function selectionPlugins(
  options: { readonly selection?: () => Promise<SuiteSelection>; readonly suite?: string },
  coverageFile: string,
  root: string,
  configRoot: string,
  context: SelectingContext = {},
) {
  const { argv = process.argv, env = process.env, say = (line: string) => process.stderr.write(`${line}\n`) } = context;
  const request = { root, from: configRoot, ...(options.suite === undefined ? {} : { suite: options.suite }) };
  const asked = askedSelection(options.selection, () => coverageFile, request, env);
  if (asked === undefined) return [];
  if (watching(argv)) {
    say('variance-authority: watch mode does not select');
    return [];
  }
  if (env['VARIANCE_AUTHORITY_GRAIN'] === 'case') throw caseGrain();
  const key = options.selection === undefined ? `${coverageFile}\0${root}\0${options.suite ?? ''}` : undefined;
  const selection = key === undefined ? asked : () => {
    let read = reads.get(key);
    if (read === undefined) reads.set(key, read = asked());
    return read;
  };
  return [selectingPlugin(selection, root)];
}

/** Whether Rstest was started to watch: its `watch` command, or `-w` on its default one. */
function watching(argv: readonly string[]): boolean {
  const args = argv.slice(2);
  return args[0] === 'watch' || args.some((arg) => arg === '-w' || arg === '--watch' || (arg.startsWith('--watch=') && arg !== '--watch=false'));
}

/**
 * What a configuration listing projects adds when a selection is asked for:
 * Rstest reads `passWithNoTests` there, not on a project, so a run every
 * project's selection emptied runs nothing and passes, as Jest's wrap does.
 */
export function rootSelection(
  options: { readonly selection?: () => Promise<SuiteSelection>; readonly suite?: string },
  coverageFile: string,
  root: string,
  configRoot: string,
  context: SelectingContext = {},
): { passWithNoTests?: true } {
  return selectionPlugins(options, coverageFile, root, configRoot, { ...context, say: () => {} }).length === 0
    ? {}
    : { passWithNoTests: true };
}

/** The part of a project's configuration, as `modifyRstestConfig` hands it, that the selection reads and extends. */
interface PlannedConfig {
  readonly root: string;
  readonly include: readonly string[];
  readonly includeSource?: readonly string[];
  exclude: { patterns: string[] };
  passWithNoTests?: boolean;
}

/** The part of Rsbuild's plugin API this plugin reads. */
interface SelectingApi {
  readonly useExposed: (id: string) => {
    readonly modifyRstestConfig?: (callback: (config: PlannedConfig) => Promise<void>) => void;
  } | undefined;
}

/**
 * The plugin that leaves out of a project the files `selection` skips, and
 * says what it kept. A project it keeps no file of runs nothing and passes.
 *
 * `root` is the checkout the selection names files against. A selection that
 * names cases is refused: a kept file runs whole here, and a run that asked
 * for less would read as having had it.
 */
export function selectingPlugin(selection: () => Promise<SuiteSelection>, root: string) {
  return {
    name: 'variance-authority:selection',
    setup(api: SelectingApi): void {
      api.useExposed('rstest')?.modifyRstestConfig?.(async (config) => {
        const asked = await selection();
        if (asked.cases !== undefined && asked.cases.size > 0) throw caseGrain();
        const found = await projectFiles(config);
        const name = (file: string): string => projectPath(root, file);
        const runs = new Set(kept(asked, found, name));
        for (const line of selectedLines(asked, found.map(name))) console.error(line);
        const skipped = found.filter((file) => !runs.has(file));
        config.exclude.patterns.push(...excluded(config.root, skipped));
        if (runs.size === 0) config.passWithNoTests = true;
      });
    },
  };
}

function caseGrain(): Error {
  return new Error(
    'variance-authority: VARIANCE_AUTHORITY_GRAIN=case is not kept under Rstest, which runs every kept file whole; ' +
      'unset it to leave out whole files.',
  );
}

/**
 * The test files Rstest plans for a project, found as its own planning finds
 * them: its `include` globbed under its root with its `exclude` ignored, a
 * literal `include` that names no file on disk kept as given, and the files its
 * `includeSource` finds that hold `import.meta.rstest`. Rstest has replaced
 * `<rootDir>` in them by the time the callback runs.
 */
async function projectFiles(config: PlannedConfig): Promise<string[]> {
  const root = config.root.replaceAll('\\', '/');
  const { include, includeSource = [] } = config;
  const options = { cwd: config.root, absolute: true, ignore: config.exclude.patterns, dot: true, expandDirectories: false };
  const [globbed, sources] = await Promise.all([
    glob(include, options),
    includeSource.length === 0 ? [] : glob(includeSource, options),
  ]);
  const literal = include.filter((pattern) => !isDynamicPattern(pattern)).map((pattern) => posix.resolve(root, pattern));
  const inSource = await Promise.all(
    sources.map(async (file) => ((await readFile(file, 'utf8').catch(() => '')).includes('import.meta.rstest') ? [file] : [])),
  );
  // Rstest's planning names files with forward slashes on every platform, as the glob does.
  return [...new Set([...globbed, ...literal.filter((file) => !existsSync(file)), ...inSource.flat()])].sort();
}

/** The longest pattern this plugin adds: picomatch refuses one past 65 536 characters. */
const PATTERN_LIMIT = 60_000;

/**
 * Absolute paths as `exclude` patterns that match them alone, relative to the
 * project's `root`, as the glob reads an ignore pattern: an absolute one is
 * made relative to a root it escapes differently, and stops matching under a
 * root whose name holds `@`, `+` or `,`. The files under the root share their
 * common directory and the rest of each sits in brace alternations, so
 * thousands of skipped files compile to a handful of patterns rather than one
 * per file, which a matcher would test every path against in turn. A file
 * above the root, which an `include` may reach, is a pattern of its own.
 */
export function excluded(root: string, paths: readonly string[]): string[] {
  const from = root.replaceAll('\\', '/');
  const relatives = paths.map((path) => posix.relative(from, path.replaceAll('\\', '/')));
  const above = relatives.filter((path) => path.startsWith('../'));
  const under = relatives.filter((path) => !path.startsWith('../'));
  return [...grouped(under), ...above.map(escaped)];
}

function grouped(paths: readonly string[]): string[] {
  if (paths.length < 2) return paths.map(escaped);
  const common = paths.reduce((prefix, path) => {
    while (!path.startsWith(prefix)) prefix = prefix.slice(0, prefix.lastIndexOf('/', prefix.length - 2) + 1);
    return prefix;
  }, paths[0]!.slice(0, paths[0]!.lastIndexOf('/') + 1));
  const patterns: string[] = [];
  let group: string[] = [];
  let length = 0;
  const close = (): void => {
    if (group.length > 0) patterns.push(`${escaped(common)}${group.length === 1 ? group[0]! : `{${group.join(',')}}`}`);
    group = [];
    length = 0;
  };
  for (const rest of paths.map((path) => escaped(path.slice(common.length)))) {
    if (length + rest.length + 1 > PATTERN_LIMIT - common.length) close();
    group.push(rest);
    length += rest.length + 1;
  }
  close();
  return patterns;
}

/** A path as a glob that matches it alone: its glob characters escaped, unlike a regular expression's. */
function escaped(path: string): string {
  return path.replace(/[*?[\]{}()!+@,\\]/g, '\\$&');
}
