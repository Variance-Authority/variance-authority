/**
 * The suites a repository runs, named and given a kind before any of them runs.
 *
 * A repository that runs Jest for units, Playwright for journeys and a Storybook
 * suite for pictures used to hold all three in one record. Each run re-cut the
 * modules it loaded, a run under another instrumentation mode discarded the
 * rest, and one recorded commit stood for suites that ran at different commits.
 * Nor could the record say what kind of test had entered a line, which is the
 * question a reviewer asks first: is this changed line pinned by a unit test,
 * or only by an end-to-end journey, and why did payment code run while the
 * pictures were taken?
 *
 * So the `suites` key of the root config names each suite and its kind, and
 * each suite records into a directory of its own. The declaration is read here
 * and nowhere else; the CLI carries this reading rather than repeating it.
 *
 * ```json
 * { "suites": { "unit": { "kind": "unit" }, "stories": { "kind": "visual" } } }
 * ```
 *
 * The kind is not inferred from the runner. A Playwright suite may be `e2e` or
 * `visual`, and a Vitest browser suite may be `unit` or `visual`; only the
 * repository knows which it meant.
 */

// compass: variance-authority.reach

import { rootConfig } from './cache-layers.js';

/**
 * What a suite is for. A closed list, because a reader that groups by kind, or a
 * rule that says what a kind may reach, needs to know what each one means.
 */
export const SUITE_KINDS = ['unit', 'integration', 'e2e', 'visual'] as const;

export type SuiteKind = (typeof SUITE_KINDS)[number];

/**
 * One suite the root config declares: the name a seam's `suite` option gives,
 * and what kind of test it runs.
 */
export interface DeclaredSuite {
  /** The key it is declared under, and the name of its record directory. */
  readonly name: string;
  readonly kind: SuiteKind;
}

/**
 * A suite name is a directory name under the cache, so it is one path segment
 * that cannot climb out of it and cannot be mistaken for a layer's own dotted
 * directory.
 */
const SUITE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * A `suites` value the declaration's rules refuse.
 *
 * Structured so a reader with its own way of naming a setting — the CLI's
 * `ConfigError` — says the same refusal in its own shape rather than
 * re-deriving it.
 */
export class SuitesError extends Error {
  constructor(
    readonly where: string,
    readonly field: string,
    readonly said: string,
  ) {
    super(`${where}: "${field}" ${said}`);
    this.name = 'SuitesError';
  }
}

/**
 * Check a `suites` value and return the suites it declares, sorted by name.
 *
 * Pure, so the CLI parses the same value with the same rules. `where` prefixes
 * every refusal, and is the file the value came from. An empty object declares
 * nothing while looking configured, and is refused.
 */
export function parseSuites(value: unknown, where: string): readonly DeclaredSuite[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SuitesError(where, 'suites', `must be an object from each suite's name to its kind, not ${JSON.stringify(value)}`);
  }
  const names = Object.keys(value).sort();
  if (names.length === 0) {
    throw new SuitesError(where, 'suites', 'declares no suite; remove it, or name each suite the repository runs');
  }

  return names.map((name) => {
    if (!SUITE_NAME.test(name)) {
      throw new SuitesError(
        where,
        `suites.${name}`,
        'is not a suite name: it names a directory in the cache, so it is letters, digits, ".", "_" ' +
          'and "-", and starts with a letter or a digit',
      );
    }
    const declared: unknown = (value as Record<string, unknown>)[name];
    const keys = typeof declared === 'object' && declared !== null && !Array.isArray(declared)
      ? Object.keys(declared)
      : undefined;
    const kind = keys === undefined ? undefined : (declared as Record<string, unknown>)['kind'];
    if (keys === undefined || keys.some((key) => key !== 'kind') || !SUITE_KINDS.includes(kind as SuiteKind)) {
      throw new SuitesError(
        where,
        `suites.${name}`,
        `must be { "kind": ${SUITE_KINDS.map((one) => `"${one}"`).join(' | ')} }, not ${JSON.stringify(declared)}`,
      );
    }

    return { name, kind: kind as SuiteKind };
  });
}

/**
 * The suites the root config of `root`'s repository declares, or undefined when
 * it declares none — one record with no name and no kind, as before suites.
 */
export function declaredSuites(root: string): readonly DeclaredSuite[] | undefined {
  const config = rootConfig(root);
  if (config === undefined || config.value['suites'] === undefined) return undefined;

  return parseSuites(config.value['suites'], config.file);
}

/**
 * The one suite a run records into, or reads from, checked against the declaration.
 *
 * Undefined when the repository declares no suites and none is named: the
 * record is the repository's one. A name the declaration does not carry is
 * refused, and so is no name once any suite is declared, because the record it
 * would write is one nobody declared, and the record it would read is a guess.
 */
export function declaredSuite(root: string, suite: string | undefined): DeclaredSuite | undefined {
  const declared = declaredSuites(root);
  const file = rootConfig(root)?.file ?? 'the root variance.config.json';
  if (declared === undefined) {
    if (suite === undefined) return undefined;
    throw new Error(
      `the suite "${suite}" is named, and ${file} declares no suites; declare it there under "suites", with its kind`,
    );
  }
  const listed = declared.map((one) => `"${one.name}"`).join(', ');
  if (suite === undefined) {
    throw new Error(`${file} declares the suites ${listed}, and none is named; name the suite this run is`);
  }
  const found = declared.find((one) => one.name === suite);
  if (found === undefined) {
    throw new Error(`the suite "${suite}" is not declared in ${file}, which declares ${listed}`);
  }

  return found;
}
