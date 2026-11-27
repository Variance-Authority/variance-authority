// compass: variance-authority.reach.crossings
/**
 * The machine each test file ran on, as the runs record beside a record names
 * it: what `variance view` carries of that record into its page. The page
 * shows it only where the runs stand at the record's own commit.
 */

import { describeMachine, filesMachines, readCommitRuns } from '@variance-authority/sense/test-selection';

/** The machine each test file ran on, as a reader says it, or why none was read. */
export type RanOn =
  | {
      /** The commit the runs stand at; absent outside a checkout, where they match no record. */
      readonly commit?: string;
      /** Each file's machine; a file the runs name none for, or two, is absent. */
      readonly files: Readonly<Record<string, string>>;
    }
  | { readonly unread: string };

/** The machines the runs record beside `recording` names; undefined where no runs record is there. */
export async function ranOn(recording: string): Promise<RanOn | undefined> {
  let runs;
  try {
    runs = await readCommitRuns(recording);
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
  if (runs === undefined) return undefined;
  const files: Record<string, string> = {};
  for (const [file, machine] of filesMachines(runs)) if (machine !== undefined) files[file] = describeMachine(machine);
  return { ...(runs.commit === undefined ? {} : { commit: runs.commit }), files };
}
