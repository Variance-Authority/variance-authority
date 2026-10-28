/**
 * The `globalSetup` `withTestSelection` adds when the run selects: it reads the
 * selection before Playwright collects a file, so `testIgnore` can drop what it
 * skips. See `file-selection.ts`.
 */

// compass: variance-authority.reach

import { fileSelection } from './file-selection.js';

export default async function readSelection(): Promise<void> {
  const asked = fileSelection();
  if (asked === undefined || asked.selection !== undefined) return;
  // This seam cuts no case, so a file that runs, runs whole.
  const { cases: _, ...selection } = await asked.read();
  asked.selection = selection;
}
