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
  'index',
  'select',
  'reach',
  'covering',
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
  index: ['--no-git'],
  select: ['--since', '--execution', '--diff', '--format', '--no-git'],
  reach: ['--since', '--format', '--whole-files', '--no-git'],
  covering: [
    '--file',
    '--line',
    '--function',
    '--at-distance',
    '--in-package',
    '--text',
    '--since',
    '--against',
    '--cases',
    '--execution',
    '--root',
    '--format',
  ],
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
    '--name',
    '--package',
    '--subpath',
    '--query',
    '--under',
    '--above',
    '--inside',
    '--beside',
    '--left-of',
    '--right-of',
    '--on',
    '--from',
    '--to',
    '--changed-file',
    '--taint-file',
    '--just-answer',
    '--limit',
    '--at',
    '--format',
  ],
  distill: ['--test', '--eyes', '--execution', '--root', '--format'],
  watch: [],
  adjudicate: ['--claims', '--exit-zero-on-changes'],
  accept: ['--all', '--shape', '--message-file', '--message'],
  changelog: ['--component', '--subject', '--limit', '--since'],
  journeys: ['--all', '--file', '--limit', '--into'],
  push: ['--run', '--commit', '--branch'],
  serve: ['--just-answer'],
  doctor: [],
  share: ['--ref', '--publish'],
  comment: ['--body-file', '--run-url', '--marker'],
};

export const USAGE = [
  'variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>] [--run <id> --commit <sha>] [--since <ref>] [--against <ref>] [--flakes] [--exit-zero-on-changes]',
  'variance index   [--no-git]',
  'variance select  [--since <ref>] [--execution <journey-file> [--diff <patch>|-]] [--format plain|json|vitest|jest] [--no-git]',
  'variance reach   --since <ref> [--format plain|json] [--whole-files] [--no-git]',
  'variance covering --file <path> [--line <n>] [--function <name>] [--at-distance <hops>] [--in-package] [--text <path>|-] | --since <ref> [--against <record>] [--cases last|<test file>] [--execution <path>] [--root <path>] [--format text|refs|json]',
  'variance report  [--config <path>] [--format text|json|html] [--subject <id>] [--exit-zero-on-changes] [<report>...]',
  'variance ask     [--config <path>] [<question>] [--subject <id>] [--subjects <id>[,...]] [--component <name>] [--rule <id>] [--shape <digest>] [--claims <path>] [--test <id>] [--state <state>] [--file <text>] [--name <name>] [--package <name>] [--subpath <subpath>] [--query <words>] [--under|--above|--inside|--beside|--left-of|--right-of <words>] [--on <words>] [--from <path>] [--to <path>] [--changed-file <path>] [--taint-file <path>] [--just-answer] [--limit <n>] [--at <address>] [--format text|json] [<report>...]',
  'variance distill --test <id> [--eyes <path>] [--execution <path>] [--root <path>] [--format text|json]',
  'variance watch',
  'variance adjudicate [--config <path>] --claims <path> [--exit-zero-on-changes] [<report>...]',
  'variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]',
  'variance changelog [--config <path>] [--component <text>] [--subject <id>] [--limit <n>] [--since <rev>]',
  'variance journeys [--config <path>] [--all] [--file <text>] [--limit <n>] [<shard.bin>... [--into <path>]] | finalize <journey-file> | stitch <shard.bin>... --into <journey-file>',
  'variance push    [--config <path>] [--run <id>] [--commit <sha>] [--branch <name>] [<report>...]',
  'variance serve   [--config <path>] [--just-answer] # MCP over stdio',
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
 * `watch`, `distill`, `covering`, `index`, `select` and `reach` do not read
 * project configuration. One holds a live listener; the next two read evidence
 * a run left behind, named on the command line or found where a run puts it;
 * the last three are asked by a repository whose tests another runner runs, and
 * which may have configured this tool for nothing else.
 */
const CONFIGLESS: readonly string[] = ['watch', 'distill', 'covering', 'index', 'select', 'reach'];

export function flagsFor(command: (typeof COMMANDS)[number]): readonly string[] {
  return CONFIGLESS.includes(command)
    ? PER_COMMAND[command]
    : [...GLOBAL, ...PER_COMMAND[command]];
}

/**
 * The one synopsis line for a command, as `USAGE` prints it.
 *
 * What a refusal about a command shows instead of the whole table. A reader who
 * typed `variance ask --quer` is not choosing a command — they have chosen it,
 * and the other fifteen lines are fifteen things to read past. That matters
 * most to the reader who cannot skim: an agent recovering from a typo should get
 * back the shape of the command it is already running and nothing else.
 *
 * Read out of `USAGE` rather than kept beside it, so there is still exactly one
 * place a synopsis is written.
 */
export function synopsisFor(command: (typeof COMMANDS)[number]): string {
  // The command name, then either padding or the end of the line: `watch` takes
  // no flags and its synopsis is the bare `variance watch`, which a trailing
  // space would miss — and the fallback below would then answer a reader who
  // asked about one command with all sixteen.
  return (
    USAGE.split('\n').find((line) => /^variance (\w+)/.exec(line)?.[1] === command) ?? USAGE
  );
}

/**
 * The commands that can answer `1`, because they reach a verdict about the UI.
 *
 * `run` compares, `report` re-reads what a comparison wrote, and `adjudicate`
 * holds a comparison against a declaration; each of the three ends in `exitFor`
 * or its sibling and can therefore say "changes need review". Every other
 * command returns `0` when it did what was asked and `2` when it could not, and
 * a help text that offered them `1` would describe an outcome the command has no
 * way to produce — `accept` promotes a baseline or refuses, and a reader waiting
 * for its `1` is waiting for a code that is never coming.
 */
const REVIEWS: readonly string[] = ['run', 'report', 'adjudicate'];

/**
 * What `variance <command> --help` prints: that command, and nothing else.
 *
 * Assembled from the tables above rather than written out a seventeenth time, so a
 * flag added to `PER_COMMAND` appears here the same day. A reader who typed a
 * command has already chosen it; answering with the whole table is answering a
 * question they did not ask, and the exit codes are repeated because they are the
 * part of this tool a CI step consumes and the part nobody remembers — narrowed
 * to the codes *this* command can return, for the reason {@link REVIEWS} gives.
 */
export function helpFor(command: (typeof COMMANDS)[number]): string {
  const flags = flagsFor(command);
  return [
    synopsisFor(command),
    '',
    `flags: ${flags.length === 0 ? 'none' : flags.join(', ')}`,
    ...(flags.includes('--no-git')
      ? ['--no-git: read file contents from the working tree, not from Git\'s object store. Git still lists the files and names each file\'s blob, so the source index is the same one and unchanged files are not read again.']
      : []),
    ...(flags.includes('--whole-files')
      ? ['--whole-files: walk from every changed file whole, without reading what the edit changed. The list is never shorter than the default one; it is the list a file-by-file import graph gives.']
      : []),
    REVIEWS.includes(command)
      ? 'exit codes: 0 nothing needs review, 1 changes need review, 2 operator error.'
      : 'exit codes: 0 done, 2 operator error.',
  ].join('\n');
}

/** Whether a word is one of the commands above, narrowed for the parser. */
export function isCommand(value: string): value is (typeof COMMANDS)[number] {
  return (COMMANDS as readonly string[]).includes(value);
}
