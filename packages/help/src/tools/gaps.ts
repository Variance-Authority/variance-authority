import type { Tool } from '@variance-authority/mcp';
import { NO_ARGS } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { undocumented } from '@variance-authority/package/help';
import { audience } from './format.js';

/**
 * `docs_gaps` — the names other packages import and which say nothing.
 *
 * The tool an agent calls to be given work, and the reason a reading of usage is
 * worth taking: *61% of names are documented* is a statistic nobody acts on,
 * while *these eleven names are imported across a package boundary and are
 * silent* is a morning, spent on the eleven anybody would have hit first.
 *
 * A name nothing imports is left out. It may be undocumented because it is dead,
 * and a list that mixed the two would bury the ones with an audience under the
 * ones with a question mark.
 */
export const gaps: Tool<Help> = {
  name: 'docs_gaps',
  description:
    'Published names that other packages import and that have no documentation, ordered by how ' +
    'many packages import them. Each carries the file and line to open. Names nothing imports ' +
    'are excluded — the list is what is undocumented in front of an audience.',
  inputSchema: NO_ARGS,

  run(help) {
    const found = undocumented(help);
    if (found.length === 0) return 'Every name imported across a package boundary carries documentation.';

    const crossing =
      found.length === 1
        ? '1 name crosses a package boundary'
        : `${found.length} names cross a package boundary`;

    return [
      `${crossing} with nothing written above the declaration:`,
      '',
      ...found.map(
        (entry) =>
          `${entry.name} [${entry.kind}] ${entry.at}:${entry.line} — used by ${audience(entry, 5)}`,
      ),
    ].join('\n');
  },
};
