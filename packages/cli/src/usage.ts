/**
 * What this tool offers, written down once.
 *
 * The statement about the product, kept apart from the parser that enforces it
 * and the lexer underneath that. A reader deciding what the tool *does* reads
 * this file and nothing else; `parse.ts` reads it to refuse what is not here,
 * the README shows it verbatim, and a repository check fails if those two ever
 * say different things.
 *
 * Everything is one table per question a reader can ask: which commands exist,
 * which flags each takes, and the synopsis each is printed back in. A command
 * added to one table and not the others does not compile or does not pass, which
 * is the point of them being adjacent rather than derived from each other — the
 * synopsis carries an order and a spelling no list of flags could produce.
 */

export const COMMANDS = [
  'run',
  'select',
  'report',
  'ask',
  'distill',
  'watch',
  'adjudicate',
  'accept',
  'changelog',
  'journeys',
  'push',
  'serve',
  'doctor',
  'share',
  'comment',
] as const;

export const DEFAULT_CONFIG = 'variance.config.json';

/** Flags every command that reads configuration takes, listed once so the refusals stay accurate. */
export const GLOBAL = ['--config'] as const;

export const PER_COMMAND: Record<(typeof COMMANDS)[number], readonly string[]> = {
  run: [
    '--profile',
    '--subjects',
    '--intent',
    '--run',
    '--commit',
    '--since',
    '--against',
    '--flakes',
    '--exit-zero-on-changes',
  ],
  select: ['--since', '--format'],
  report: ['--format', '--subject', '--exit-zero-on-changes'],
  ask: [
    '--subject',
    '--subjects',
    '--component',
    '--rule',
    '--shape',
    '--claims',
    '--test',
    '--state',
    '--file',
    '--query',
    '--from',
    '--limit',
    '--at',
  ],
  distill: ['--test', '--eyes', '--execution', '--format'],
  watch: [],
  adjudicate: ['--claims', '--exit-zero-on-changes'],
  accept: ['--all', '--shape', '--message-file', '--message'],
  changelog: ['--component', '--subject', '--limit', '--since'],
  journeys: ['--all', '--file', '--limit', '--into'],
  push: ['--run', '--commit', '--branch'],
  serve: [],
  doctor: [],
  share: ['--ref', '--publish'],
  comment: ['--body-file', '--run-url', '--marker'],
};

export const USAGE = [
  'variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>] [--run <id> --commit <sha>] [--since <ref>] [--against <ref>] [--flakes] [--exit-zero-on-changes]',
  'variance select  [--since <ref>] [--format plain|json|vitest|jest]',
  'variance report  [--config <path>] [--format text|json|html] [--subject <id>] [--exit-zero-on-changes] [<report>...]',
  'variance ask     [--config <path>] [<question>] [--subject <id>] [--subjects <id>[,...]] [--component <name>] [--rule <id>] [--shape <digest>] [--claims <path>] [--test <id>] [--state <state>] [--file <text>] [--query <words>] [--from <words>] [--limit <n>] [--at <address>] [<report>...]',
  'variance distill --test <id> [--eyes <path>] [--execution <path>] [--format text|json]',
  'variance watch',
  'variance adjudicate [--config <path>] --claims <path> [--exit-zero-on-changes] [<report>...]',
  'variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]',
  'variance changelog [--config <path>] [--component <text>] [--subject <id>] [--limit <n>] [--since <rev>]',
  'variance journeys [--config <path>] [--all] [--file <text>] [--limit <n>] [<shard.bin>... [--into <path>]]',
  'variance push    [--config <path>] [--run <id>] [--commit <sha>] [--branch <name>] [<report>...]',
  'variance serve   [--config <path>]              # MCP over stdio',
  'variance doctor  [--config <path>]',
  'variance share   [--config <path>] [--ref <ref>] [--publish] [<report>]',
  'variance comment [--config <path>] [--body-file <path>] [--run-url <url>] [<report>...] | --marker',
  '',
  '`--version` prints this tool. `push` also prints the deployment it reached, and says so when the two disagree.',
  'exit codes: 0 nothing needs review, 1 changes need review, 2 operator error.',
  'A verdict and a crash never share a code.',
].join('\n');

/**
 * The flags a command accepts, the configuration ones included where they apply.
 *
 * `watch`, `distill` and `select` do not read project configuration. One holds a
 * live listener; the second reads evidence paths named on the command line; the
 * third is asked by a repository whose tests another runner runs, and which may
 * have configured this tool for nothing else.
 */
const CONFIGLESS: readonly string[] = ['watch', 'distill', 'select'];

export function flagsFor(command: (typeof COMMANDS)[number]): readonly string[] {
  return CONFIGLESS.includes(command)
    ? PER_COMMAND[command]
    : [...GLOBAL, ...PER_COMMAND[command]];
}

/** Whether a word is one of the commands above, narrowed for the parser. */
export function isCommand(value: string): value is (typeof COMMANDS)[number] {
  return (COMMANDS as readonly string[]).includes(value);
}
