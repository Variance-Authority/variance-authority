import { adjudicate } from './tools/adjudicate.js';
import { changelog } from './tools/changelog.js';
import { changes } from './tools/changes.js';
import { composition } from './tools/composition.js';
import { describe } from './tools/describe.js';
import { explain } from './tools/explain-verdict.js';
import { findings } from './tools/findings.js';
import { summarize } from './tools/summary.js';
import { NO_ARGS, stringArg, type Served, type Tool } from './tools/tool.js';
import { trace } from './tools/trace-component.js';

/**
 * The tools, as pure functions over a run report.
 *
 * Separated from the transport deliberately. A tool implementation tangled into
 * a JSON-RPC handler can only be exercised by speaking JSON-RPC at it, and the
 * interesting question — *does this answer help an agent fix the thing?* — then
 * becomes the hardest thing in the package to ask.
 *
 * Every answer is text, and the shape of that text is the product. An agent does
 * not benefit from a JSON blob it has to interpret; it benefits from the same
 * sentence a person would want, with a file path on the end. So these read like
 * the report does: cause first, collateral counted, and a path an editor opens.
 *
 * `variance_adjudicate` is the one tool that takes evidence *in*. It sits third
 * because it needs nothing the first two printed and everything they cannot
 * supply: an agent's own account of what it was doing. The other eight answer
 * *what changed*; this one answers *what changed against what you claimed*, and
 * its third arm — declared, and did not happen — is the only thing here that can
 * catch an edit which never landed. An agent that has just edited something
 * should call it before `describe`, and an agent reviewing somebody else's run
 * has nothing to declare and should skip it.
 *
 * One tool per module under `./tools/`, and this file is the list. Each answer is
 * a paragraph somebody argued about, and the arguments do not compose — the
 * reason the summary refuses to say "nothing to review" has nothing to do with
 * the reason findings are grouped by rule — so they are read, and edited, one at
 * a time. What stays here is the only thing that is genuinely about all nine:
 * the order, which is the order `tools/list` announces them in and therefore the
 * order an agent meets them in. `variance_summary` is first because every other
 * tool takes an argument it printed, and `variance_changes` is second because it
 * is the one that decides how many of the rest get called: an agent that walks
 * forty changed subjects one at a time spends forty calls learning what one call
 * says, which is *three things happened and one of them explains thirty-one*.
 *
 * `variance_composition` is fourth, and the boundary it sits on is the one worth
 * seeing: the first five answer about the *suite* and the last four narrow to a
 * subject. It goes after `changes` rather than before because the two reshape
 * the same run along different axes and only one of them is about this run's
 * diff — `changes` says which decisions there are, and this says which component
 * and which caller is behind one, including when the answer is *nothing in this
 * run*.
 *
 * `variance_changelog` closes the suite-level group because it is the only tool
 * here that is not about the run. The other eight describe what a run observed;
 * this one describes what *accepting* it would write down, and that answer is
 * the last thing an agent needs before it proposes a command. Its position is
 * also a claim about when it stops being useful: after acceptance there is
 * nothing to preview, because the record exists and `git log` has it.
 *
 * It is the second tool whose answer changes with the agent's own input, and
 * unlike `adjudicate` the input is not evidence — it is the selection, the same
 * one `accept` takes. That is why it must not be earlier: an agent that has not
 * yet read `changes` has no shape to ask about, and would be told what `--all`
 * records before knowing whether `--all` is what it wants.
 */

export type { Served, Tool };

// The tool-authoring contract, not an implementation detail of these nine. A
// server over another subject writes tools against the same interface, and the
// first thing any tool does with a model's argument is refuse it or narrow it.
export { NO_ARGS, stringArg };

export const TOOLS: readonly Tool[] = [
  summarize,
  changes,
  adjudicate,
  composition,
  changelog,
  describe,
  findings,
  trace,
  explain,
];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
