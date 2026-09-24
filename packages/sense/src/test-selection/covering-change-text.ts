import type { CoveringChange, CoveringTest, ExecutionTest } from './reverse.js';

/**
 * The review reading, in words, for whichever surface is asking.
 *
 * Its own module because two of them ask. The CLI prints it under
 * `variance covering --since`, and the MCP tool `variance_changed_tests` hands
 * it to an agent holding a patch. Both had their own copy of these sentences,
 * and the copies drifted the way two copies do: one of them was still printing
 * a call-stack depth that this project records as zero everywhere, so every
 * witness an agent read arrived as `depth 0 —`. A reading with two renderers
 * has two answers, and nobody finds out which one a reader saw.
 *
 * It lives beside {@link coveringChange} rather than in either caller, because
 * the words are about the shape rather than about the transport — the same
 * reason `@variance-authority/distill` ships `formatDistillation` next to
 * `distill`. Text is the output format here and there is no other: an agent
 * reads the prose, and a program that wants the data calls `coveringChange` and
 * has the value already.
 */

/**
 * Where the reading came from, said once at the top when the caller knows.
 *
 * The MCP tool is handed an index by its host and cannot honestly name a path
 * or a ref; the CLI read a file at a commit and can. So every field is optional
 * and an absent one prints nothing, rather than the caller passing a placeholder
 * that reads like an answer.
 */
export interface CoveringChangeHeading {
  /** The ref the diff was taken against. */
  readonly since?: string;
  /** Where the index was read, so an empty answer can be checked against a path. */
  readonly from?: string;
  /** The commit the record stands at. The diff is measured from it. */
  readonly at?: string;
}

/**
 * The counts first, then the regions that produced them.
 *
 * The header is the part a reviewer acts on, so it leads. Two numbers matter
 * and neither is a percentage: regions the change touched that no case covered
 * by a route it chose, and regions one case alone covered. The first is a hole
 * in the evidence; the second is evidence resting on a single point, which is
 * the reading a line count cannot express at all.
 *
 * A case that was only inside a region while its module evaluated is counted
 * apart. It was present, it did not go there, and folding the two together
 * would make every module-scope constant look as watched as the function under
 * it.
 */
export function formatCoveringChange(
  changed: readonly CoveringChange[],
  heading: CoveringChangeHeading = {},
): string {
  const regions = changed.flatMap((file) => file.regions);
  const blind = regions.filter((region) => region.tests.length === 0);
  const holes = blind.filter((region) => (region.stopped?.length ?? 0) > 0);
  const alone = regions.filter((region) => region.tests.length === 1);
  const silent = changed.filter((file) => !file.recorded && file.cases.length === 0);

  const lines = [
    `${count(changed.length, 'changed file')}${
      heading.since === undefined ? '' : ` since ${heading.since}`
    }, ${count(regions.length, 'changed region')}: ${blind.length} nothing covered${
      holes.length === 0 ? '' : ` (${holes.length} of them ${holes.length === 1 ? 'a hole' : 'holes'})`
    }, ${alone.length} covered by one case.`,
    ...source(heading),
  ];

  for (const file of changed) {
    lines.push('', file.file);
    if (file.cases.length > 0) {
      lines.push(
        `  a test file — ${count(file.cases.length, 'named case')} declared here, which is ` +
          'what changed rather than what was covered:',
      );
      lines.push(...file.cases.map((test) => `    ${test.name} [${test.id}]`));
    }
    if (!file.recorded) {
      if (file.cases.length === 0) {
        lines.push(
          '  no row — the recorded run never loaded this file, which is not the same as nobody covering it',
        );
      }
      continue;
    }
    if (file.regions.length === 0) {
      lines.push('  in the index, and the change landed on no recorded region of it');
      continue;
    }
    for (const region of file.regions) {
      lines.push(`  ${extent(region)} — ${claim(region)}${carried(region.passengers)}`);
      lines.push(...region.tests.map((test) => `    ${describe(test)}`));
      lines.push(...(region.stopped ?? []).map((test) => `    stopped first: ${describe(test)}`));
    }
  }

  if (silent.length > 0) {
    lines.push(
      '',
      `${silent.length} changed path${silent.length === 1 ? ' has' : 's have'} no row here at all. ` +
        'The reading above is about the rest of the diff.',
    );
  }
  return lines.join('\n');
}

/**
 * The provenance line, printed only where there is provenance to print.
 *
 * A reader looking at an empty answer needs to check it against a path before
 * believing it, and *which file did you read* is the first question. Under MCP
 * the host holds the index and the answer is nobody's to give, so the line is
 * absent rather than guessed.
 */
function source(heading: CoveringChangeHeading): readonly string[] {
  if (heading.from === undefined) return [];
  return [`Read from ${heading.from}${heading.at === undefined ? '' : `, recorded at ${heading.at}`}.`];
}

function count(of: number, noun: string): string {
  return `${of} ${noun}${of === 1 ? '' : 's'}`;
}

function extent(region: CoveringChange['regions'][number]): string {
  return `${region.startLine}-${region.endLine} ${region.kind}${
    region.name === '' ? '' : ` ${region.name}`
  }`;
}

/**
 * What the witnesses amount to, with the cases that stopped before arriving.
 *
 * A stopped case recorded where it went and nothing past that, so a region it
 * could have reached and did not is a hole, not a region nobody walked, and a
 * single witness beside it is not known to be alone.
 */
function claim(region: CoveringChange['regions'][number]): string {
  const tests = region.tests.length;
  const stopped = region.stopped?.length ?? 0;
  if (tests === 0) {
    if (stopped > 0) return `a hole: no case covered this region, and ${count(stopped, 'case')} that could have reached it stopped first`;
    return region.stopped === undefined
      ? 'no case covered this region'
      : 'no case covered this region, and every case that could have reached it finished';
  }
  const also = stopped === 0 ? '' : `, and ${count(stopped, 'case')} that could have reached it stopped first`;
  if (tests === 1) return stopped === 0 ? '1 case, and it is the only witness' : `1 case${also}`;
  return `${tests} cases${also}`;
}

/**
 * The cases present while the module evaluated, or why they are not counted.
 *
 * A region that ran during load and was read without the file graph has
 * loaders nobody named. Printing nothing there would make it read like a
 * region no case was ever inside.
 */
function carried(passengers: CoveringChange['regions'][number]['passengers']): string {
  if (passengers === undefined) {
    return ' (also ran while the module evaluated; no file graph this reading held names who loaded it)';
  }
  return passengers.length === 0 ? '' : ` (+${passengers.length} carried in while the module evaluated)`;
}

/**
 * One witness.
 *
 * No depth is printed. `ExecutionCrossing.distance` is call-stack depth, which
 * this project's collector writes zero into everywhere, so a depth beside every
 * name advertised a reading nothing here has ever produced. Import distance is
 * the question a reader actually had, and the CLI measures it on demand behind
 * `--at-distance`.
 */
function describe(test: CoveringTest | ExecutionTest): string {
  return `${test.name} — ${test.file} [${test.id}]`;
}
