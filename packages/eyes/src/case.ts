/**
 * Hand a closed journal to the case the runner is running.
 *
 * Eyes cannot name the case its journal belongs to and does not try: a runner's
 * test id is not the id the record joins by, and a title is not unique. A
 * recording run installs a case scope in the realm for as long as each case
 * runs, under the symbol Sense's runner seams use, and the scope keeps what it
 * is handed under the case and the attempt it already knows. A run that does
 * not record installs none, and the journal stays the test's own.
 *
 * The record names files against the checkout, so a journal that reaches it is
 * spelled the same way: every source location a target or a commit carries is
 * made relative to the scope's root before it is handed over.
 */

import { relativizeSource, type SourceLocation } from '@variance-authority/core/format';
import type { EyesJournal } from './access.js';

/** Mirrors `CASE_SCOPE` in `@variance-authority/sense`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

interface RecordingScope {
  readonly root: string;
  readonly eyes: (journal: Readonly<Record<string, unknown>>) => boolean;
  readonly watch?: () => void;
}

function recordingScope(): RecordingScope | undefined {
  const scope = (globalThis as { [CASE_SCOPE]?: Partial<RecordingScope> })[CASE_SCOPE];
  if (scope === undefined || typeof scope.eyes !== 'function' || typeof scope.root !== 'string') return undefined;
  return scope as RecordingScope;
}

/**
 * Hand a closed journal to the running case.
 *
 * `false` when no recording run is in scope, and the journal goes nowhere.
 */
export function handToRunningCase(journal: EyesJournal): boolean {
  const scope = recordingScope();
  if (scope === undefined) return false;
  return scope.eyes(relativeTo(journal, scope.root) as unknown as Readonly<Record<string, unknown>>);
}

/**
 * Tell the running case a journal was opened for it, so the record tells a case
 * that never handed one over apart from a case that opened none.
 *
 * `false` when no recording run is in scope, or its scope takes no such word.
 */
export function watchRunningCase(): boolean {
  const watch = recordingScope()?.watch;
  if (typeof watch !== 'function') return false;
  watch();
  return true;
}

/** `journal` with every source location spelled relative to `root`. */
function relativeTo(journal: EyesJournal, root: string): EyesJournal {
  return relocated(journal, root) as EyesJournal;
}

function isLocation(value: unknown): value is SourceLocation {
  const candidate = value as Partial<SourceLocation> | null;
  return typeof candidate === 'object' && candidate !== null && typeof candidate.file === 'string' &&
    typeof candidate.line === 'number' && typeof candidate.column === 'number';
}

function relocated(value: unknown, root: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => relocated(entry, root));
  if (typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = key === 'source' && isLocation(entry) ? relativizeSource(entry, root) : relocated(entry, root);
  }
  return copy;
}
