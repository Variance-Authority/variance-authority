import { firstSentence, HELP_TOOLS, type Help } from '@variance-authority/help/tools';
import { COSTS_TOOLS, REVIEW_TOOLS, TOOLS, VANTAGE_TOOLS, verbOf, type Tool } from '@variance-authority/mcp/tools';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import { takes, type Asked } from './asking.js';

/**
 * The questions, split by what each needs: a run's report, a live watcher, a
 * checkout, the share's times or the review deployment. A section keeps the
 * order its set chose, and each entry is what the question takes and the first
 * sentence of its MCP tool's description, unedited; the rest is `tools/list`'s.
 */
export function questions(): string {
  return [
    'Ask about a visual run, a running suite, the code, what the suite costs, or what review decided and suspects.',
    '',
    'ABOUT THE LAST RUN',
    '',
    ...TOOLS.flatMap(entry),
    '',
    'ABOUT A SUITE THAT IS STILL RUNNING',
    '',
    ...VANTAGE_TOOLS.flatMap(entry),
    '',
    'ABOUT THE WORKSPACE SOURCE',
    '',
    ...(HELP_TOOLS as readonly Tool<Help>[]).flatMap(entry),
    '',
    'ABOUT WHAT THE SUITE COSTS',
    '',
    ...COSTS_TOOLS.flatMap(entry),
    '',
    'ABOUT WHAT REVIEW DECIDED AND SUSPECTS',
    '',
    ...REVIEW_TOOLS.flatMap(entry),
    '',
    'Each question\'s whole description is its MCP tool\'s, as `variance serve` sends it at `tools/list`.',
    'The report is the configured one unless report paths are named.',
    'With no configured report on disk, it is read from the share: your branch\'s line, then the mainline\'s.',
    '`--config` and sharded reports work as they do on `variance report`.',
    `Live questions need \`--at <address>\`, which defaults to \`${VANTAGE_VARIABLE}\`;`,
    '`variance watch` starts a watcher and prints both.',
    'Source questions read the index `variance index` published for the working directory, and need no config: after an edit, run `variance index`, then ask.',
    'Costs are the mainline\'s, read from the share, unless report paths are named.',
    'Decisions and concerns are read from the review deployment with the share token, which never decides.',
    '',
  ].join('\n');
}

/** Two lines: what the question takes, and the first sentence of its description. */
function entry(tool: Asked): readonly string[] {
  return [`${verbOf(tool)}${takes(tool)}`, `    ${firstSentence(tool.description)}`];
}
