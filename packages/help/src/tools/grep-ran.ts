/**
 * `grep --test`: ripgrep over the files one recorded test entered, each
 * matching line marked by whether the test ran it.
 *
 * The recording owns which regions the test entered; ripgrep owns the text.
 * The files searched are the modules the test entered at least one region of,
 * so a file it only loaded, a file it never reached and a file no recording
 * instruments are not searched. Each line is classified by sense's `passedAt`:
 * ran when an innermost region holding it was entered, or not taken in the
 * outermost region holding it that the test did not enter.
 *
 * The regions are spans of the commit the recording ran at. A file edited since
 * is read through git's diff against that commit, as `journeys` reads a line: a
 * hit is classified where its line stood then, and a line written since is
 * listed apart, since no recording made there can have run it.
 */

// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';
import { linesThen, passedAt, testsRan, type RanRegion, type TestRan } from '@variance-authority/sense';
import { nextPage, pageAt, paged, type Page, type Spelling } from '@variance-authority/mcp/tools';
import { byFile } from './format.js';
import { ofSuite } from './asked-test.js';
import { ripgrep, type Hit } from './ripgrep.js';

/** One suite's matching lines, split by whether the test ran them. */
interface Marked {
  readonly suite?: string;
  readonly ran: TestRan;
  readonly taken: readonly Hit[];
  /** Each with the outermost region holding it that the test did not enter, and whether the rest of its line ran. */
  readonly passed: readonly { readonly hit: Hit; readonly by: RanRegion; readonly partly: boolean }[];
  /** Lines written since the recorded commit. */
  readonly written: readonly Hit[];
  /** A file read through its diff against the recorded commit, or that git could not diff. */
  readonly notes: readonly string[];
  readonly errors: readonly string[];
}

/** The suites that hold the test `file` and `name` choose, and why each other suite does not. */
export interface GrepRan {
  readonly answered: readonly Marked[];
  readonly refused: readonly string[];
}

/** Each suite's matching lines for the chosen test, or the refusals when no suite holds it. */
export function grepRan(root: string, query: string, file: string, name: string | undefined): GrepRan {
  const suites = testsRan(root, file, name);
  if (suites.length === 0) throw new Error(`\`grep --test\` reads the recording, and the one under ${root} holds no suite to read`);
  const holding = suites.filter(({ ran }) => ran.notRecorded === undefined || ran.notRecorded === null);
  const refused = suites.filter((suite) => !holding.includes(suite)).map(({ suite, ran }) => `${ofSuite(suite)}${ran.notRecorded}`);
  if (holding.length === 0) throw new Error(refused.join('\n'));
  const answered = holding.map(({ suite, ran, commit }) => {
    const modules = new Map(ran.modules.map((module) => [module.file, module]));
    const files = [...modules.keys()].sort(codeUnitOrder);
    const { hits, errors } = ripgrep(root, query, files);
    const taken: Hit[] = [];
    const passed: { hit: Hit; by: RanRegion; partly: boolean }[] = [];
    const written: Hit[] = [];
    const notes: string[] = [];
    for (const file of files) {
      const inFile = hits.filter((hit) => hit.file === file);
      if (inFile.length === 0) continue;
      const then = commit === undefined ? undefined : linesThen(root, commit, file, inFile.map((hit) => hit.line));
      if (then?.unplaced != null) notes.push(`${file}: ${then.unplaced}, so each line is read where it stands now.`);
      else if (then?.changed === true) {
        notes.push(`${file} changed since the recorded commit: each line is read where it stood then, and a region is named by its lines then.`);
      }
      inFile.forEach((hit, at) => {
        const line = then === undefined || then.unplaced != null ? hit.line : then.lines[at];
        if (line == null) return void written.push(hit);
        const kept = passedAt(modules.get(file)!, line);
        if (kept === undefined) taken.push(hit);
        else passed.push({ hit, by: kept.region, partly: kept.partly });
      });
    }
    return { ...(suite === undefined ? {} : { suite }), ran, taken, passed, written, notes, errors };
  });
  return { answered, refused };
}

/**
 * The answer, ran lines first, then the lines in regions the test passed by.
 * Each suite's lines are one ordered list, so `page` counts across its
 * sections, and every suite shows the same rows of its own list.
 */
export function formatGrepRan(query: string, { answered, refused }: GrepRan, page: Page, spell: Spelling): string {
  return [...answered.map((marked) => formatSuite(query, marked, page, spell)), ...refused].join('\n\n');
}

/** The rows of `page` that fall in a section starting at `start` of the suite's list. */
function within<Row>(rows: readonly Row[], start: number, page: Page): readonly Row[] {
  const from = Math.max(0, page.offset - start);
  return paged(rows, { offset: from, limit: Math.max(0, page.offset + page.limit - start - from) });
}

function formatSuite(query: string, { suite, ran, taken, passed, written, notes, errors }: Marked, page: Page, spell: Spelling): string {
  const test = ran.test!;
  const entered = ran.modules.length;
  const searched = `${entered === 1 ? 'the 1 recorded file' : `the ${entered} recorded files`} ${ofSuite(suite)}${test.file}  ${test.name} entered`;
  // What bounds the rows is said after them, once the answer is read.
  const noted = [
    'note: files no recording instruments were not searched.',
    ...(errors.length === 0 ? [] : [`note: ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} reading them; the first: ${errors[0]}`]),
    ...notes.map((note) => `note: ${note}`),
  ];
  const total = taken.length + passed.length + written.length;
  if (total === 0) return [`Nothing in ${searched} matches \`${query}\`.`, ...noted].join('\n');
  const matched = new Set([...taken, ...passed.map(({ hit }) => hit), ...written].map((hit) => hit.file)).size;
  const lines = [`${total} matching ${total === 1 ? 'line' : 'lines'} in ${matched} of ${searched}:`, ...pageAt(page, total, spell)];
  const ranShown = within(taken, 0, page);
  if (ranShown.length > 0) lines.push('Ran:', ...byFile(ranShown));
  const passedShown = within(passed, taken.length, page);
  if (passedShown.length > 0) {
    const rows = passedShown.map(({ hit, by, partly }) => ({ ...hit, note: `in ${region(by)}, which it did not enter${partly ? '; the rest of the line ran' : ''}` }));
    lines.push('Not taken:', ...byFile(rows));
  }
  const writtenShown = within(written, taken.length + passed.length, page);
  if (writtenShown.length > 0) lines.push('Written since the recording, so no test has run it:', ...byFile(writtenShown));
  return [...lines, ...noted, ...nextPage(page, total, spell)].join('\n');
}

/** `branch 5-7 of pay`, or `function pay 1-8`, under a row that names the file. */
function region({ kind, line, end, function: of }: RanRegion): string {
  const named = of === undefined || of === null ? '' : of;
  if (kind === 'function') return `function ${named === '' ? '' : `${named} `}${line}-${end}`;
  return `${kind} ${line}-${end}${named === '' ? '' : ` of ${named}`}`;
}
