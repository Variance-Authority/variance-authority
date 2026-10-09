/**
 * The project that ran each case, as the runner reported it.
 *
 * A file two projects both match runs once under each, and the case scope
 * records both copies under one file and one name: only the runner's id tells
 * them apart, and that id is a hash nobody reads. The name a reader knows the
 * copy by is the project's, which the configuration wrote and the runner hands
 * over when the run ends. So it is carried from the report, joined to the case
 * by the runner's id, and a case the runner named no project for has none.
 */

import type { FinishedCase } from './case-durations.js';
import { projectPath } from './instrumented-modules.js';

/** The project a recorded case ran under, or `undefined` when the runner named none. */
export type CaseProjects = (file: string, id: string) => string | undefined;

/** A lookup that names no project, for a run whose runner reported none. */
export const UNNAMED: CaseProjects = () => undefined;

/** The projects every announcement of a finished file named, keyed the way a recorded case is. */
export function caseProjects(
  files: readonly { readonly filepath: string; readonly cases?: readonly FinishedCase[] }[],
  root: string,
): CaseProjects {
  const byId = new Map<string, string>();
  for (const file of files) {
    const path = projectPath(root, file.filepath);
    for (const held of file.cases ?? []) {
      if (held.id !== undefined && held.project !== undefined) byId.set(`${path}\0${held.id}`, held.project);
    }
  }
  return (file, id) => byId.get(`${file}\0${id}`);
}
