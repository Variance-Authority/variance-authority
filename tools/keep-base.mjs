/**
 * Lay the mainline's record of each suite into this checkout's own layer:
 * `node tools/keep-base.mjs [suite]`. Named, one suite; unnamed, every suite
 * the root config gives to the share.
 *
 * `suiteBase` reads the record from the line, or the read `take-base.mjs`
 * already laid, and `layMainline` lays it with the runs record its publishing
 * run carried as a seed: the restore a cache-carried suite gets from the
 * Actions cache, and nothing a developer's checkout does. When the line gave no
 * record it says why, and the suite has no base; nothing older is put in its
 * place. A record without its case index selects nothing, and says so too.
 *
 * Given one suite, it appends `record=<dir>`, the directory the record is laid
 * in, and `based=true` when the record keeps its cases, to `$GITHUB_OUTPUT`.
 * The notices go to stdout, where the runner reads workflow commands.
 */

import { appendFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { layMainline, mainlineMissed, mainlineRead, suiteBase } from '@variance-authority/cli';
import { declaredSuites, keepsCases, testCoverageFile } from '@variance-authority/sense/test-selection';

const root = process.cwd();
const named = process.argv.slice(2);
const suites = named.length > 0 ? named : (declaredSuites(root) ?? []).filter(({ carry }) => carry === 'share').map(({ name }) => name);

for (const suite of suites) {
  const base = await suiteBase(root, { suite });
  if (base.from === 'mainline') {
    await layMainline(root, base.mainline);
    console.error(mainlineRead(base.mainline));
  } else if ('missed' in base && base.missed !== undefined) {
    console.error(mainlineMissed(base.missed));
  }
  const recording = testCoverageFile(root, { suite });
  const cased = keepsCases(recording);
  if (!cased) {
    console.log(
      existsSync(recording)
        ? `::notice::The ${suite} base record was read without its case index, so ${suite} has nothing to select from or compare with: it runs whole, and its coverage is printed without a comparison.`
        : `::notice::The mainline's ${suite} record was not read, so ${suite} has no base: it runs whole, and its coverage is printed without a comparison.`,
    );
  }
  if (named.length === 1 && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${cased ? 'based=true\n' : ''}record=${dirname(recording)}\n`);
  }
}
