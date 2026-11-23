// compass: variance-authority.reach
/**
 * `variance proves`: the regions one recorded test entered, each broken in
 * the extreme under a command that runs the test, and which breaks it
 * survived.
 *
 * The command chooses the test and the runner; this chooses the regions,
 * from the record, and serves each break without writing the checkout. A
 * survivor says the test passed with the region broken, and never why.
 */

import { regionPlace } from '@variance-authority/help/tools';
import { extremeBreaks, repositoryRoot, type ExtremeRegion } from '@variance-authority/sense/test-selection';
import { EXIT_CLEAN, OperatorError, type ExitCode } from '../exit.js';
import type { ParsedProves } from '../proves-args.js';
import type { Streams } from './configless.js';

/** What a survivor can mean, said under every answer. */
const LIMIT = 'A survivor is an assertion that does not read the region, or a break that changes nothing the test can observe: this run cannot tell which.';

/** Run `parsed`'s command under each break, and print which the test survived. */
export async function runProves({ file, name, limit, run }: ParsedProves, streams: Pick<Streams, 'out'>, cwd = process.cwd()): Promise<ExitCode> {
  const root = repositoryRoot(cwd);
  const answer = await extremeBreaks({ root, file, ...(name === undefined ? {} : { name }), command: run, cwd, limit });
  if ('refused' in answer) throw new OperatorError(`\`proves\`: ${answer.refused}`);
  const place = (region: ExtremeRegion): string => regionPlace(region.file, region);
  const broken = (region: ExtremeRegion): string => `  ${place(region)}  ${region.kind === 'function' ? 'returns nothing' : 'skipped'}`;
  const section = (title: string, rows: readonly string[]): string[] => (rows.length === 0 ? [] : [title, ...rows, '']);
  streams.out(
    [
      `${answer.test.file}  ${answer.test.name}`,
      '',
      ...section('Survived, the test passed with the region broken:', answer.survived.map(broken)),
      ...section('Noticed, the test failed with the region broken:', answer.noticed.map(broken)),
      ...section('Hung, the test was still running at its deadline with the region broken, and was stopped:', answer.hung.map(broken)),
      ...section('Not broken:', [
        ...answer.unbroken.map(({ region, reason }) => `  ${place(region)}  ${reason}`),
        ...(answer.pastCap === 0 ? [] : [`  ${answer.pastCap} more ${answer.pastCap === 1 ? 'region' : 'regions'} past the cap of ${limit}: \`--limit\` raises it`]),
      ]),
      LIMIT,
      '',
    ].join('\n'),
  );
  return EXIT_CLEAN;
}
