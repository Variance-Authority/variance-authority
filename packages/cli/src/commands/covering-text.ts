/**
 * The answer to `variance covering`, written for whoever asked.
 *
 * Split from the reading because the reading is one and the shapes are many:
 * a person reads the text, an editor and an agent read the JSON, and a code
 * host reads its own format, which `covering-review.ts` writes.
 */

import {
  formatCoveringChange,
  type CoveringTest,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import type { CoveringRange } from './covering-frame.js';
import { formatReview } from './covering-review.js';
import type { Covering, CoveringFormat, StatedChange } from './covering.js';

/** Say the answer in the shape the caller asked for. */
export function formatCovering(answer: Covering, format: CoveringFormat): string {
  if (format === 'json') return `${JSON.stringify(answer, undefined, 2)}\n`;
  if (format === 'text') return `${[...scopeText(answer), text(answer)].join('\n')}\n`;
  return formatReview(answer, format);
}

function text(answer: Covering): string {
  if (answer.changed !== undefined) return sinceText(answer, answer.changed);
  if (answer.frame === 'stale') return staleText(answer);
  if (answer.ranges !== undefined) return wholeFile(answer, answer.ranges);

  const tests = answer.tests ?? [];
  const target = answer.target ?? { function: '' };
  const where = 'line' in target ? `line ${target.line}` : `function ${target.function}`;
  if (tests.length === 0) {
    return [
      `No named test covered ${where} of ${answer.file}${unentered(answer.stopped)}`,
      ...(answer.stopped ?? []).map((test) => `  stopped: ${test.name} — ${test.file} [${test.id}]`),
      ...narrowedText(answer),
    ].join('\n');
  }
  return [
    `${tests.length} named test${tests.length === 1 ? '' : 's'} covered ${where} of ${answer.file}${
      answer.state === 'alone' ? ', and it is the only case that could have' : ''
    }:`,
    ...tests.map((test) => `  ${describe(test)}`),
    ...narrowedText(answer),
  ].join('\n');
}

/**
 * Which cases the answer was read from, before anything it says.
 *
 * A focused answer reads exactly like the suite's, and the two lead to
 * opposite decisions about a region nobody entered, so it is said first.
 */
function scopeText(answer: Covering): readonly string[] {
  const scope = answer.scope;
  if (scope === undefined) return [];
  const count = `${scope.tests.length} case${scope.tests.length === 1 ? '' : 's'}`;
  return [scope.cases === 'last'
    ? `Read from the ${count} of the last run${scope.at === undefined ? '' : ` at ${scope.at.slice(0, 12)}`}, not the whole suite.`
    : `Read from the ${count} of ${scope.cases}, not the whole suite.`];
}

/**
 * The file was edited since the recording and the recorded text is not in
 * history, so there is no line to give.
 */
function staleText(answer: Covering): string {
  return `${answer.file} is not the text the suite ran over${
    answer.at === undefined ? '' : ` at ${answer.at.slice(0, 12)}`
  }, and that text could not be found, so no recorded line is a place in it. Run the suite to record it again.`;
}

function wholeFile(answer: Covering, ranges: readonly CoveringRange[]): string {
  const file = answer.file ?? '';
  if (ranges.length === 0) return `No line of ${file} is recorded in ${answer.from}.`;
  const named = new Set(ranges.flatMap((range) => range.tests.map((test) => test.id)));
  const lines = [
    `${file} — ${ranges.length} recorded range${ranges.length === 1 ? '' : 's'}, ${
      named.size
    } named test${named.size === 1 ? '' : 's'}${framed(answer)}`,
  ];
  for (const range of ranges) {
    lines.push(`${range.startLine === range.endLine
      ? `line ${range.startLine}`
      : `lines ${range.startLine}-${range.endLine}`}${range.state === undefined ? '' : ` — ${range.state}`}${
      range.moved === true ? ', edited since the recording' : ''
    }`);
    lines.push(...(range.tests.length === 0
      ? [`  no named test covered this range${unentered(range.stopped)}`]
      : range.tests.map((test) => `  ${describe(test)}`)));
    lines.push(...(range.tests.length === 0 ? range.stopped ?? [] : []).map((test) =>
      `    stopped: ${test.name} — ${test.file} [${test.id}]`,
    ));
  }
  lines.push(...narrowedText(answer));
  return lines.join('\n');
}

/** Which text the line numbers are in, when that was checked. */
function framed(answer: Covering): string {
  if (answer.frame === 'mapped') return ', placed in the text as it is now';
  return '';
}

/**
 * Why nobody entered: a hole, unwalked, or a record that cannot tell them apart.
 *
 * A case that stopped recorded where it went and nothing past that, so the
 * absence of its name is not evidence. Printing the bare *no named test* over a
 * hole would read as permission to delete the code.
 */
function unentered(stopped: readonly ExecutionTest[] | undefined): string {
  if (stopped === undefined) return '.';
  if (stopped.length === 0) return ', and every case that could have reached it finished: unwalked.';
  return ` — a hole: ${stopped.length === 1 ? 'a case' : `${stopped.length} cases`} that could have ` +
    'reached it stopped first, so the record cannot see it.';
}

/**
 * What the narrowing removed, said out loud under every answer it shaped.
 *
 * A filtered list is indistinguishable from a short one, and the two lead to
 * opposite decisions: *one test covers this line* is an argument for writing
 * another, and *one test covers it within three hops, of eleven that cover it*
 * is an argument about where the eleven live. So the counts are printed even
 * when nothing was removed — a band that filtered nothing is a fact about the
 * code, not an absent feature.
 *
 * The sentence says how many survived and stops there. *The rest are further
 * out* would be a second claim, and a false one whenever the rest are tests the
 * walk could not place at all — which on a recording made against built output
 * is most of them. Why each one left is the notes' job, and the notes say it.
 */
function narrowedText(answer: Covering): readonly string[] {
  const narrowed = answer.narrowed;
  if (narrowed === undefined) return [];
  return [
    `${narrowed.kept} of ${narrowed.of} named test${narrowed.of === 1 ? '' : 's'} that covered ` +
      'it are inside the narrowing.',
    ...narrowed.notes.map((note) => `  ${note}`),
  ];
}

/**
 * The review reading, which `variance_changed_tests` also prints.
 *
 * The words live in `@variance-authority/sense/test-selection` beside
 * `coveringChange`, because two surfaces ask for them and a reading with two
 * renderers has two answers. All this adds is the provenance the CLI is the
 * only one able to state: the ref the diff was taken against, the file the
 * index was read from, and the commit it stands at.
 */
function sinceText(answer: Covering, changed: readonly StatedChange[]): string {
  return formatCoveringChange(changed, {
    ...(answer.since === undefined ? {} : { since: answer.since }),
    from: answer.from,
    ...(answer.at === undefined ? {} : { at: answer.at }),
  });
}

function describe(test: CoveringTest): string {
  return `${test.name} — ${test.file} [${test.id}]${test.loaded === true ? ' (its file imports the module; ran while it evaluated)' : ''}`;
}
