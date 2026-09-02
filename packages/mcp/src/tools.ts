import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { VantageState } from '@variance-authority/vantage';
import { adjudicate } from './tools/adjudicate.js';
import { changelog } from './tools/changelog.js';
import { changes } from './tools/changes.js';
import { composition } from './tools/composition.js';
import { describe } from './tools/describe.js';
import { diff, diffState, type StateDifference } from './tools/diff.js';
import { explain } from './tools/explain-verdict.js';
import { findings } from './tools/findings.js';
import { summarize } from './tools/summary.js';
import { sourceTests } from './tools/source-tests.js';
import { runSignals } from './tools/run-signals.js';
import { testSignals } from './tools/test-signals.js';
import { NO_ARGS, stringArg, type Tool } from './tools/tool.js';
import { trace } from './tools/trace-component.js';
import { variations } from './tools/variations.js';

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
 * `variance_adjudicate` is the one tool that takes evidence *in*. It follows
 * `summary` and `changes` because it needs nothing they printed and everything
 * they cannot supply: an agent's own account of what it was doing. The other report tools
 * answer *what changed*; this one answers *what changed against what you claimed*, and
 * its third arm — declared, and did not happen — is the only thing here that can
 * catch an edit which never landed. An agent that has just edited something
 * should call it before `describe`, and an agent reviewing somebody else's run
 * has nothing to declare and should skip it.
 *
 * One tool per module under `./tools/`, and this file is the list. Each answer is
 * a paragraph somebody argued about, and the arguments do not compose — the
 * reason the summary refuses to say "nothing to review" has nothing to do with
 * the reason findings are grouped by rule — so they are read, and edited, one at
 * a time. What stays here is the only thing that is genuinely about the set:
 * the order, which is the order `tools/list` announces them in and therefore the
 * order an agent meets them in. `variance_summary` is first because every report
 * tool takes an argument it printed. `variance_diff` sits beside it as the session
 * question, and `variance_changes` follows because it
 * is the one that decides how many of the rest get called: an agent that walks
 * forty changed subjects one at a time spends forty calls learning what one call
 * says, which is *three things happened and one of them explains thirty-one*.
 *
 * `variance_composition` follows `adjudicate`, and the boundary it sits on is
 * the one worth seeing: the first seven answer about the *suite* and the last four narrow to a
 * subject. It goes after `changes` rather than before because the two reshape
 * the same run along different axes and only one of them is about this run's
 * diff — `changes` says which decisions there are, and this says which component
 * and which caller is behind one, including when the answer is *nothing in this
 * run*.
 *
 * `variance_variations` follows it, on the same axis and one step further out. Both
 * compare this run to itself; `composition` compares subjects that were never
 * meant to differ, and this compares the ones that were. It is the only tool here
 * whose answer is not, in any reading, a finding — which is why it is neither
 * earlier (an agent triaging a visual diff would spend a call learning that a dark story
 * is dark) nor omitted (when a change *is* to a flagged component, what the flag
 * does is the first thing the reviewer does not know).
 *
 * `variance_changelog` closes the suite-level group because it is the only tool
 * here that is not about the run. The other report tools describe what a run observed;
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

export type { Served, Tool, ToolInvocation } from './tools/tool.js';
export type { StateDifference };

// The tool-authoring contract, not an implementation detail of this set. A
// server over another subject writes tools against the same interface, and the
// first thing any tool does with a model's argument is refuse it or narrow it.
export { NO_ARGS, stringArg };
export { notObservedSentence } from './tools/subject.js';
export { diffState };

/** The source-to-named-test tool set for an MCP server over an execution index. */
export const SOURCE_TEST_TOOLS = [sourceTests, diff as Tool<ExecutionIndex>] as const;

/** Look up one source-test tool without widening it to the visual-report subject. */
export function sourceTestToolByName(name: string): Tool<ExecutionIndex> | undefined {
  return SOURCE_TEST_TOOLS.find((tool) => tool.name === name);
}

/**
 * The tool set for a watcher attached to a suite that is still running.
 *
 * A third subject, and the first one that is not a thing somebody produced. The
 * report tools answer about a run that finished and the source-test tools answer
 * about an index that was written; these answer about a run *in flight*, held in
 * the memory of the process answering, and gone when it exits.
 *
 * The listing comes first for the same reason `variance_summary` does: the other
 * two take an argument it printed. `variance_diff` is last here rather than
 * second, because on a live subject it is not the session question but the
 * *progress* question — what the suite did between two asks — and that is only
 * worth asking once a reader knows what they are watching.
 */
export const VANTAGE_TOOLS = [
  runSignals,
  testSignals,
  diff as Tool<VantageState>,
] as const;

/** Look up one live-run tool without widening it to the visual-report subject. */
export function vantageToolByName(name: string): Tool<VantageState> | undefined {
  return VANTAGE_TOOLS.find((tool) => tool.name === name);
}

export const TOOLS: readonly Tool[] = [
  summarize,
  diff,
  changes,
  adjudicate,
  composition,
  variations,
  changelog,
  describe,
  findings,
  trace,
  explain,
];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
