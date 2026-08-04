import { describe } from './tools/describe.js';
import { explain } from './tools/explain-verdict.js';
import { findings } from './tools/findings.js';
import { summarize } from './tools/summary.js';
import type { Tool } from './tools/tool.js';
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
 * One tool per module under `./tools/`, and this file is the list. Each answer is
 * a paragraph somebody argued about, and the arguments do not compose — the
 * reason the summary refuses to say "nothing to review" has nothing to do with
 * the reason findings are grouped by rule — so they are read, and edited, one at
 * a time. What stays here is the only thing that is genuinely about all five: the
 * order, which is the order `tools/list` announces them in and therefore the
 * order an agent meets them in. `variance_summary` is first because every other
 * tool takes an argument it printed.
 */

export type { Tool };

export const TOOLS: readonly Tool[] = [summarize, describe, findings, trace, explain];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
