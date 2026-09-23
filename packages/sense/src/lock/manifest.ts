/**
 * Whether a `package.json` moved anything the install comparison does not read.
 *
 * A manifest is two documents in one file. Its dependency fields are a request
 * the lockfile answers, so a diff of them is read there, by package name, and
 * counting the manifest again would widen for what was just measured. Its
 * resolution fields — `exports`, `imports`, `main`, `module`, `browser`,
 * `type`, `sideEffects`, `name` — are read by every resolver and bundler that
 * loads the package and by nothing in the lockfile, so a diff of them moves
 * which file each importer of the package loads while the install stays
 * byte-identical.
 *
 * The rule is therefore a list of what the install *does* speak for, plus what
 * no module reads, and everything else moved. An unknown field goes the
 * conservative way: a tool's config block (`jest`, `babel`, `browserslist`)
 * is read at run time by whatever owns it, and this cannot say it is inert.
 */

export const MANIFEST = 'package.json';

/**
 * Fields a difference in which is the install comparison's to read, or no
 * module's.
 */
const SPOKEN_FOR: ReadonlySet<string> = new Set([
  // The request the lockfile answers.
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'dependenciesMeta',
  'bundleDependencies',
  'bundledDependencies',
  'resolutions',
  'overrides',
  'pnpm',
  'workspaces',
  'packageManager',
  'version',
  // Read by a package manager, a registry or a person, never by a module.
  'scripts',
  'description',
  'keywords',
  'license',
  'licenses',
  'author',
  'contributors',
  'maintainers',
  'funding',
  'homepage',
  'bugs',
  'repository',
  'files',
  'publishConfig',
  'engines',
  'os',
  'cpu',
  'private',
  'directories',
  'man',
]);

/**
 * True when the two texts differ in a field outside {@link SPOKEN_FOR}.
 *
 * `undefined` is a manifest absent at that end: an added or deleted
 * `package.json` makes or unmakes a package, which is a move. A text that does
 * not parse as a JSON object is a move as well — the resolver reading it fails
 * or reads something else, and this cannot say which.
 */
export function manifestMoved(before: string | undefined, after: string | undefined): boolean {
  if (before === after) return false;
  const was = fieldsOf(before);
  const is = fieldsOf(after);
  if (was === undefined || is === undefined) return true;

  for (const field of new Set([...Object.keys(was), ...Object.keys(is)])) {
    if (SPOKEN_FOR.has(field)) continue;
    // Order is meaning here: `exports` conditions are matched first to last,
    // so a reordering is a move and a textual comparison is the exact one.
    if (JSON.stringify(was[field]) !== JSON.stringify(is[field])) return true;
  }
  return false;
}

function fieldsOf(text: string | undefined): Readonly<Record<string, unknown>> | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
