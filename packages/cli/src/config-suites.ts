import { parseBefore, parseSuites, SuitesError, type DeclaredSuite } from '@variance-authority/sense/test-selection';
import { fail, type ParseOptions } from './config-values.js';

export type { DeclaredSuite };

/** What the repository runs, and what each run rests on before reach. */
export interface RestsOn {
  /** The suites the repository runs, and their kinds; read from the root file only. */
  readonly suites?: readonly DeclaredSuite[];

  /**
   * What every suite rests on before any test imports anything: `.nvmrc`, a CI
   * workflow. Each suite adds its own — the runner config, the setup it loads.
   *
   * Nothing imports a config, so nothing has an edge to it, and the walk that
   * answers *what did this change move* reaches nothing from one. Declared, each
   * entry is walked along the arrows instead, files and packages both, and a
   * change anywhere in that closure — a `jsdom` bump the config wires in, the
   * polyfill its setup imports — runs the whole suite. Paths from the
   * repository root, as the diff spells them; a directory covers what is under
   * it. Read from the root file only.
   */
  readonly before?: readonly string[];
}

/**
 * The `suites` and `before` sections.
 *
 * The declarations belong to the test runner seams, which read the root file
 * themselves, so their rules live in `@variance-authority/sense` and are carried
 * here rather than written twice. A refusal comes back in this file's shape,
 * naming the field.
 */
export function parseRestsOn(root: Record<string, unknown>, options: ParseOptions): RestsOn {
  try {
    const suites = root['suites'] === undefined ? undefined : parseSuites(root['suites'], options.source);
    const before = root['before'] === undefined ? undefined : parseBefore(root['before'], 'before', options.source);
    return { ...(suites === undefined ? {} : { suites }), ...(before === undefined ? {} : { before }) };
  } catch (error) {
    if (error instanceof SuitesError) fail(error.field, error.said, options);
    throw error;
  }
}
