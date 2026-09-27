import { HELP_TOOLS, type Help } from '@variance-authority/help/tools';
import { COSTS_TOOLS, TOOLS, VANTAGE_TOOLS, type Tool } from '@variance-authority/mcp/tools';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import { questionOf, takes, wrap, type Asked } from './asking.js';

/**
 * The questions, each with what it takes and what it answers.
 *
 * The tool descriptions, unedited. They are the same paragraphs an MCP client
 * puts in front of a model at `tools/list`, and a shorter gloss written here for
 * a human would be a second opinion about when to reach for each one.
 *
 * Split by subject rather than listed flat, because the parts are not
 * alternatives a reader chooses between on taste: one needs a file that already
 * exists, one needs a process that has to have been started first, one needs
 * only a checkout, and one needs a build to have published its times — and a
 * reader who does not know which part they are in asks the right question of
 * the wrong thing.
 *
 * Each half is printed straight off the set it mirrors rather than off
 * {@link QUESTIONS}, so a section is in the order that set chose — `self` leads
 * the live half because a reader who has just found a watcher should ask what it
 * is holding before asking anything of it.
 */
export function questions(): string {
  return [
    'Ask about a visual run, a running suite, the code, or what the suite costs.',
    '',
    'ABOUT THE LAST RUN',
    '',
    ...TOOLS.flatMap(entry),
    'ABOUT A SUITE THAT IS STILL RUNNING',
    '',
    ...VANTAGE_TOOLS.flatMap(entry),
    'ABOUT THE WORKSPACE SOURCE',
    '',
    ...(HELP_TOOLS as readonly Tool<Help>[]).flatMap(entry),
    'ABOUT WHAT THE SUITE COSTS',
    '',
    ...COSTS_TOOLS.flatMap(entry),
    'The report is the configured one unless report paths are named.',
    'With no configured report on disk, it is read from the share: your branch\'s line, then the mainline\'s.',
    '`--config` and sharded reports work as they do on `variance report`.',
    `Live questions need \`--at <address>\`, which defaults to \`${VANTAGE_VARIABLE}\`;`,
    '`variance watch` starts a watcher and prints both.',
    'Source questions read the checkout under the working directory and need no config.',
    'Costs are the mainline\'s, read from the share, unless report paths are named.',
    '',
  ].join('\n');
}

function entry(tool: Asked): readonly string[] {
  return [
    `${questionOf(tool)}${takes(tool)}`,
    ...wrap(tool.description, 76).map((line) => `    ${line}`),
    '',
  ];
}
