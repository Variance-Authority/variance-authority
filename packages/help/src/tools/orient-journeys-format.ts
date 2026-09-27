/**
 * The journeys part of `docs_orient`'s answer: for each file asked about, who
 * calls into its recorded functions, what they call, and which package flows
 * the cases running it take.
 *
 * Apart from `orient-format.ts` for the reason that file is apart from the
 * tool: it is a pure function of what the addon answered, and it holds the
 * wording. Every count is the addon's, read from the journeys `variance index`
 * prepared; this chooses the words and the order.
 */

// compass: variance-authority.report.agent-surface

import type { JourneysAround, JourneysBlock, JourneysCall, JourneysFile, JourneysFlows, JourneysRegion } from '@variance-authority/sense';

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** How each call is known, said once above the files. */
const KNOWN =
  'Each call says how it is known: observed, the call site ran in those cases; static, resolved from the source, ' +
  'and no recorded region shows it ran; unrecorded, a function in a file the recording does not cover; test, a helper ' +
  'the test file declares; inferred, no static target, so the way it was matched is named: by name, by `new`, as a ' +
  'value handed to a call, as a parameter, as what a factory made, or as the function it is written in.';

const TAGS = new Set(['observed', 'static', 'unrecorded', 'test']);

function known(how: string): string {
  if (TAGS.has(how)) return how;
  const said: Readonly<Record<string, string>> = {
    'name-match': 'by name',
    new: 'by `new`',
    handed: 'handed to a call',
    parameter: 'as a parameter',
    made: 'made by a factory',
    enclosed: 'written inside it',
  };
  return `inferred, ${said[how] ?? how}`;
}

const lines = (block: { readonly line: number; readonly end: number }): string =>
  block.line === block.end ? `line ${block.line}` : `lines ${block.line}–${block.end}`;

/** The far end of a call, and the asked file's own function when the question was the whole file. */
function callRow(call: JourneysCall, into: boolean): { readonly cases: string; readonly text: string } {
  const far = call.name == null ? 'the test case' : `${call.name}  ${call.file ?? ''}:${call.line ?? ''}`;
  const near = call.at == null ? '' : into ? ` → ${call.at}` : `${call.at} → `;
  return { cases: String(call.cases), text: `${into ? `${far}${near}` : `${near}${far}`}  ${known(call.known)}` };
}

function calls(heading: string, rows: readonly JourneysCall[], more: number, into: boolean, indent: string): readonly string[] {
  if (rows.length === 0) return [`${indent}${heading}: none found.`];
  const made = rows.map((call) => callRow(call, into));
  const wide = Math.max(...made.map((row) => row.cases.length));
  return [
    `${indent}${heading}:`,
    ...made.map((row) => `${indent}  ${row.cases.padStart(wide)}  ${row.text}`),
    ...(more > 0 ? [`${indent}  ${plural(more, into ? 'more caller' : 'more call')}.`] : []),
  ];
}

function blocks(heading: string, rows: readonly JourneysBlock[], more: number, indent: string): readonly string[] {
  if (rows.length === 0) return [];
  const wide = Math.max(...rows.map((block) => String(block.cases).length));
  return [
    `${indent}${heading}:`,
    ...rows.map((block) => `${indent}  ${String(block.cases).padStart(wide)}  ${block.name}  ${lines(block)}`),
    ...(more > 0 ? [`${indent}  ${plural(more, 'more function')}.`] : []),
  ];
}

function flows(flows: JourneysFlows, cases: number, indent: string): readonly string[] {
  const party = flows.package ?? 'files in no package';
  if (flows.through === 0) return [`${indent}No recorded case runs through ${party}.`];
  const share = cases === 0 ? '' : ` (${Math.max(1, Math.round((flows.through / cases) * 100))}%)`;
  const wide = Math.max(...flows.top.map((flow) => String(flow.cases).length));
  return [
    `${indent}${flows.through} of ${plural(cases, 'case')}${share} run through ${party}, along ${plural(flows.distinct, 'distinct package flow')}; ` +
      `the ${flows.top.length === 1 ? 'one' : `${flows.top.length} most`} taken, each with a case that takes it:`,
    ...flows.top.map((flow) => {
      const path = flow.packages.map((one) => one ?? 'no package').join(' → ');
      return `${indent}  ${String(flow.cases).padStart(wide)}  ${path}  (${flow.exampleFile} > ${flow.exampleName})`;
    }),
  ];
}

function region(focus: JourneysRegion, indent: string): readonly string[] {
  const out: string[] = [];
  if (focus.loaded) out.push(`${indent}It also ran while its module evaluated.`);
  const placed = focus.placedIn === focus.cases
    ? `a caller is found in every one of its ${plural(focus.cases, 'case')}`
    : `a caller is found in ${focus.placedIn} of its ${plural(focus.cases, 'case')}`;
  out.push(...calls(`Called from, ${placed}`, focus.callers, focus.moreCallers, true, indent));
  out.push(...calls('Calls', focus.goes, focus.moreGoes, false, indent));
  out.push(...blocks('Functions written inside it that cases ran', focus.inner, focus.moreInner, indent));
  return out;
}

/** The line asked about, where it sits, and whether the recording saw it. */
function lineHead(file: JourneysFile, line: number): string {
  const asked = `${file.file}:${line}`;
  const then = file.changed === true
    ? file.atCommit == null ? ' The file changed since the recording.' : ` The file changed since the recording; this was line ${file.atCommit} then.`
    : '';
  if (file.writtenSince) return `  ${asked}  was written after the recording, so no recorded case ran it.${then}`;
  const holding = file.holding == null ? '' : `; the line is in a ${file.holding.kind} (${lines(file.holding)}) that ${plural(file.holding.cases, 'case')} ran`;
  if (file.focus == null) return `  ${asked}  is in no function a recorded case ran${holding}.${then}`;
  return `  ${asked}  in ${file.focus.name} (${lines(file.focus)}), which ${plural(file.focus.cases, 'case')} ran${holding}.${then}`;
}

function fileRows(file: JourneysFile, cases: number, said: Set<string>): readonly string[] {
  const indent = '    ';
  if (!file.recorded) return [`  ${file.file}${file.line == null ? '' : `:${file.line}`}  the recording has no function in this file.`];
  // Two asks in one package share its flows, which are printed under the first.
  const party = file.flows.package ?? '';
  const flowed = said.has(party) ? [`${indent}Package flows: as above.`] : flows(file.flows, cases, indent);
  said.add(party);
  if (file.line != null) {
    return [lineHead(file, file.line), ...(file.focus == null ? [] : region(file.focus, indent)), ...flowed];
  }
  return [
    `  ${file.file}`,
    ...blocks('Functions the most cases ran', file.blocks, file.moreBlocks, indent),
    ...calls('Called from other files', file.callers, file.moreCallers, true, indent),
    ...calls('Calls into other files', file.goes, file.moreGoes, false, indent),
    ...flowed,
  ];
}

/** The journeys part, one section per suite; a suite whose journeys cannot answer says why in one line. */
export function formatJourneys(journeys: readonly JourneysAround[]): readonly string[] {
  const out: string[] = [];
  let explained = false;
  for (const { suite, answer } of journeys) {
    const named = suite === undefined ? 'Journeys' : `Journeys, suite ${suite}`;
    if (answer.notPrepared != null) {
      out.push('', `${named}: not prepared: ${answer.notPrepared}. \`variance index\` prepares them from the latest recording.`);
      continue;
    }
    const commit = answer.commit == null ? '' : ` at commit ${answer.commit.slice(0, 12)}`;
    out.push('', `${named}, from the recording${commit}, ${plural(answer.cases, 'case')} walked over the static call graph:`);
    if (!explained) {
      out.push(KNOWN);
      explained = true;
    }
    const said = new Set<string>();
    for (const file of answer.files) out.push(...fileRows(file, answer.cases, said));
  }
  return out;
}
