/**
 * `grep --test`: ripgrep over the files one recorded test entered, each
 * matching line marked by whether the test ran it.
 *
 * The recording owns which regions the test entered; ripgrep owns the text.
 * The files searched are the modules the test entered at least one region of,
 * so a file it only loaded, a file it never reached and a file no recording
 * instruments are not searched. A line is ran when the innermost recorded region
 * holding it was entered, and a line in no recorded region of an entered file
 * ran with the module. Otherwise it is not taken, and the answer names the
 * outermost region holding it that the test did not enter: where the test went
 * elsewhere.
 */

// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';
import { testsRan, type RanModule, type RanRegion, type TestRan } from '@variance-authority/sense';
import { notShown, type Spelling } from '@variance-authority/mcp/tools';
import { ripgrep, type Hit } from './ripgrep.js';

/** One suite's matching lines, split by whether the test ran them. */
interface Marked {
  readonly suite?: string;
  readonly ran: TestRan;
  readonly taken: readonly Hit[];
  /** Each with the outermost region holding it that the test did not enter. */
  readonly passed: readonly { readonly hit: Hit; readonly by: RanRegion }[];
  readonly errors: readonly string[];
}

/** The suites that hold the test `file` and `name` choose, and why each other suite does not. */
export interface GrepRan {
  readonly answered: readonly Marked[];
  readonly refused: readonly string[];
}

const ofSuite = (suite: string | undefined): string => (suite === undefined ? '' : `suite ${suite}: `);

/** Each suite's matching lines for the chosen test, or the refusals when no suite holds it. */
export function grepRan(root: string, query: string, file: string, name: string | undefined): GrepRan {
  const suites = testsRan(root, file, name);
  if (suites.length === 0) throw new Error(`\`grep --test\` reads the recording, and the one under ${root} holds no suite to read`);
  const holding = suites.filter(({ ran }) => ran.notRecorded === undefined || ran.notRecorded === null);
  const refused = suites.filter((suite) => !holding.includes(suite)).map(({ suite, ran }) => `${ofSuite(suite)}${ran.notRecorded}`);
  if (holding.length === 0) throw new Error(refused.join('\n'));
  const answered = holding.map(({ suite, ran }) => {
    const modules = new Map(ran.modules.map((module) => [module.file, module]));
    const files = [...modules.keys()].sort(codeUnitOrder);
    const { hits, errors } = ripgrep(root, query, files);
    const taken: Hit[] = [];
    const passed: { hit: Hit; by: RanRegion }[] = [];
    for (const hit of hits) {
      const by = passedBy(modules.get(hit.file)!, hit.line);
      if (by === undefined) taken.push(hit);
      else passed.push({ hit, by });
    }
    return { ...(suite === undefined ? {} : { suite }), ran, taken, passed, errors };
  });
  return { answered, refused };
}

/** The outermost region holding `line` the test did not enter, when the innermost one holding it is such a region. */
function passedBy(module: RanModule, line: number): RanRegion | undefined {
  const holding = module.regions.filter((region) => region.line <= line && line <= region.end);
  const span = (region: RanRegion): number => region.end - region.line;
  const innermost = holding.reduce<RanRegion | undefined>((best, region) => (best === undefined || span(region) <= span(best) ? region : best), undefined);
  if (innermost === undefined || innermost.entered) return undefined;
  return holding.filter((region) => !region.entered).reduce((best, region) => (span(region) > span(best) ? region : best));
}

/** The answer, ran lines first, then the lines in regions the test passed by. */
export function formatGrepRan(query: string, { answered, refused }: GrepRan, limit: number, spell: Spelling): string {
  return [...answered.map((marked) => formatSuite(query, marked, limit, spell)), ...refused].join('\n\n');
}

function formatSuite(query: string, { suite, ran, taken, passed, errors }: Marked, limit: number, spell: Spelling): string {
  const test = ran.test!;
  const entered = ran.modules.length;
  const lines = [
    `${ofSuite(suite)}${test.file}  ${test.name} entered ${entered} recorded ${entered === 1 ? 'file' : 'files'}; ` +
      'files no recording instruments were not searched.',
  ];
  if (errors.length > 0) lines.push('', `ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} reading them; the first: ${errors[0]}`);
  const total = taken.length + passed.length;
  if (total === 0) return [...lines, '', `Nothing in those files matches \`${query}\`.`].join('\n');
  const matched = new Set([...taken, ...passed.map(({ hit }) => hit)].map((hit) => hit.file)).size;
  lines.push('', `${total} matching ${total === 1 ? 'line' : 'lines'} in ${matched} ${matched === 1 ? 'file' : 'files'}.`);
  let left = limit;
  if (taken.length > 0 && left > 0) {
    lines.push('', 'Ran:');
    for (const hit of taken.slice(0, left)) lines.push(`${hit.file}:${hit.line}:${hit.text}`);
    left -= Math.min(left, taken.length);
  }
  if (passed.length > 0 && left > 0) {
    lines.push('', 'Not taken:');
    for (const { hit, by } of passed.slice(0, left)) {
      lines.push(`${hit.file}:${hit.line}:${hit.text}`, `  in ${region(hit.file, by)}, which it did not enter`);
    }
    left -= Math.min(left, passed.length);
  }
  if (total > limit) lines.push('', notShown(total - limit, spell));
  return lines.join('\n');
}

/** `branch src/order.ts:5-7 of pay`, or `function pay src/order.ts:1-8`. */
function region(file: string, { kind, line, end, function: of }: RanRegion): string {
  const named = of === undefined || of === null ? '' : of;
  if (kind === 'function') return `function ${named === '' ? '' : `${named} `}${file}:${line}-${end}`;
  return `${kind} ${file}:${line}-${end}${named === '' ? '' : ` of ${named}`}`;
}
