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
 * What a suite rests on before any of its tests imports anything is declared
 * on it too, as `before`: the runner's config and the setup it loads. The
 * repository's own `before`, at the top of the file, is what every suite rests
 * on — the Node version, the CI workflow. No rule derives either list: which
 * files govern a run is a fact only the repository knows.
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

/**
 * One of {@link SUITE_KINDS}: the role a declared suite plays, which is what a
 * reader names beside a suite's answer, since the runner alone cannot say it.
 */
export type SuiteKind = (typeof SUITE_KINDS)[number];

/**
 * Who moves an artifact from the machine that wrote it to the next one. A closed
 * list split by who moves the bytes: `actions-cache` is moved by the host, job to
 * job, and `share` is moved by `variance` itself, through the root config's
 * `share` section, where a checkout can reach it too.
 */
export const CARRIERS = ['actions-cache', 'share'] as const;

/** One of {@link CARRIERS}. */
export type Carrier = (typeof CARRIERS)[number];

/**
 * One suite the root config declares: the name a seam's `suite` option gives,
 * what kind of test it runs, and who carries its record off the machine.
 */
export interface DeclaredSuite {
  /** The key it is declared under, and the name of its record directory. */
  readonly name: string;
  readonly kind: SuiteKind;
  /** Absent when the record stays on the machine that wrote it. */
  readonly carry?: Carrier;
  /**
   * The entry points this suite's runner loads before any test: a change to one,
   * or to anything it loads, reaches every test of the suite. Absent when the
   * suite declares none, which puts nothing of its own before reach.
   */
  readonly before?: readonly string[];
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
    const carry = keys === undefined ? undefined : (declared as Record<string, unknown>)['carry'];
    const before = keys === undefined ? undefined : (declared as Record<string, unknown>)['before'];
    if (
      keys === undefined ||
      keys.some((key) => key !== 'kind' && key !== 'carry' && key !== 'before') ||
      !SUITE_KINDS.includes(kind as SuiteKind) ||
      (carry !== undefined && !CARRIERS.includes(carry as Carrier))
    ) {
      throw new SuitesError(
        where,
        `suites.${name}`,
        `must be { "kind": ${quoted(SUITE_KINDS)}, "carry"?: ${quoted(CARRIERS)}, "before"?: [paths] }, ` +
          `not ${JSON.stringify(declared)}`,
      );
    }

    return {
      name,
      kind: kind as SuiteKind,
      ...(carry === undefined ? {} : { carry: carry as Carrier }),
      ...(before === undefined ? {} : { before: parseBefore(before, `suites.${name}.before`, where) }),
    };
  });
}

/**
 * Check a `before` list: paths, matched against a diff by path, so one entry
 * may be a directory. An empty list declares nothing while looking configured,
 * and is refused, as an empty `suites` is.
 */
export function parseBefore(value: unknown, field: string, where: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((path) => typeof path !== 'string' || path === '')) {
    throw new SuitesError(where, field, `must be a non-empty list of paths, not ${JSON.stringify(value)}`);
  }
  return value as readonly string[];
}

/**
 * What a suite rests on before reach, as declared: the repository's `before`,
 * then the suite's own. Empty when neither declares any, which puts nothing
 * before reach — a changed config file then selects nothing, as any file no
 * evidence connects to a test does.
 */
export function beforeOf(root: string, suite: string | undefined): readonly string[] {
  const config = rootConfig(root);
  if (config === undefined) return [];
  const shared = config.value['before'] === undefined ? [] : parseBefore(config.value['before'], 'before', config.file);
  const own = suite === undefined ? undefined : declaredSuites(root)?.find((one) => one.name === suite)?.before;
  return [...shared, ...(own ?? [])];
}

function quoted(values: readonly string[]): string {
  return values.map((one) => `"${one}"`).join(' | ');
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
