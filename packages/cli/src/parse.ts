import { resolve } from 'node:path';
import { countOf, noPositionals, readFlags } from './args.js';
import type { ProfileId } from '@variance-authority/core/format';
import { OperatorError } from './exit.js';
import type { ReportFormat } from './commands/report.js';
import { COMMANDS, DEFAULT_CONFIG, USAGE, flagsFor, isCommand } from './usage.js';
import { parseDistill, type ParsedDistill } from './distill-args.js';
import { parseSelectArgs, type ParsedSelect } from './select-args.js';
import { parseShareArgs, type ParsedShare } from './share-args.js';
import { parsePushArgs, type ParsedPush } from './push-args.js';

export { USAGE } from './usage.js';
/**
 * The command line, parsed by hand.
 *
 * No argument-parsing dependency, for the same reason nothing else here has one:
 * this package is the entry point of a tool whose entire claim is that its output
 * can be trusted, and a transitive dependency graph is a set of things that can
 * change what `--profile` means without anybody deciding to.
 *
 * Hand-written parsing costs about eighty lines and buys three properties that
 * the convenient libraries specifically do not have:
 *
 * **An unknown flag is an error.** Every popular parser either ignores unknown
 * flags or collects them into a bag. Both are the same failure: `--subject` where
 * `--subjects` was meant runs the whole suite and reports success, and the
 * operator reads their own shell history and sees the flag they intended. A
 * misspelled flag must stop the run, and it must name the flags that exist.
 *
 * **Flags are per-command.** `--format json` is meaningless on `run`, and
 * accepting it there teaches the operator a false model of the tool. Each
 * command's accepted set is written down, and the refusal prints it.
 *
 * **A flag that takes a value must get one.** `variance report --format` with
 * nothing after it is a mistake, not a request for the default; a parser that
 * silently falls back turns a typo into a different report.
 *
 * `--flag=value` and `--flag value` are both accepted because both are muscle
 * memory, and `--` ends flag parsing so a subject id may begin with a dash.
 *
 * The hyphen-level work — reading `--flag=value`, honouring `--`, refusing a
 * repeated flag — is in `args.ts`, which is told what is accepted and decides
 * nothing about it. The part that is a statement about the *product* — which
 * commands exist, which flags each one takes, and what a reader who gets it
 * wrong is shown — is in `usage.ts`. Those three change for different reasons
 * and are read by different people, which is the whole of why they are apart.
 *
 * What is left here is the middle: turning a validated flag bag into the shape
 * `dispatch` switches on. It is the only one of the three that knows both what
 * a flag is called and what it means.
 */

export type Parsed =
  | {
      readonly command: 'run';
      readonly config: string;
      readonly profile?: ProfileId;
      readonly subjects?: string;
      readonly intent?: string;
      /**
       * `--run` and `--commit`: which run this is, for a history record.
       *
       * Both or neither is not enforced here — `identityOf` requires the pair,
       * and a half-given pair falls back to the CI environment rather than being
       * completed from two sources, which would describe a run that never existed.
       */
      readonly run?: string;
      readonly commit?: string;
      /**
       * `--since <ref>`: observe only what the diff against this ref could have
       * changed. The ref is a git revision — a branch, a tag, a SHA.
       */
      readonly since?: string;
      /**
       * `--against <ref>`: explain the run by the diff against this ref, without
       * narrowing it.
       *
       * The same walk `--since` performs and the opposite use of it. Narrowing is
       * a saving an operator opts into; the explanation is what the report
       * carries either way, so the two are separate verbs rather than one flag
       * with a side effect. Implied by `--since` when a file graph is configured.
       */
      readonly against?: string;
      /** `--flakes`: read every subject twice, not only the ones that changed. */
      readonly flakes: boolean;
      readonly exitZeroOnChanges: boolean;
    }
  | {
      readonly command: 'report';
      readonly config: string;
      readonly format: ReportFormat;
      readonly subject?: string;
      readonly exitZeroOnChanges: boolean;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
    }
  | {
      readonly command: 'ask';
      readonly config: string;
      /**
       * The question, as the first positional. Absent lists the questions.
       *
       * A positional rather than `--question`, because the whole point of this
       * command is that an agent with a shell can reach the answers an MCP client
       * reaches, and `variance ask describe --subject story:card` is the shape
       * that reads like the sentence somebody meant.
       */
      readonly question?: string;
      readonly subject?: string;
      /** `--subjects <id>[,...]`: the plural argument `changelog` takes, not `--subject`. */
      readonly subjects?: readonly string[];
      readonly component?: string;
      readonly rule?: string;
      readonly shape?: string;
      /** `--claims <path>`: the declaration `adjudicate` reads, for the question of the same name. */
      readonly claims?: string;
      /** `--test <id>`: which test, for the questions about a suite still running. */
      readonly test?: string;
      readonly state?: string;
      readonly file?: string;
      /** `--query <words>`: a description, for the questions that search names. */
      readonly query?: string;
      readonly limit?: number;
      /**
       * `--at <address>`: a running watcher to ask, instead of the last report.
       *
       * Not resolved here. The default is an environment variable, and reading
       * the environment is `dispatch`'s job — this file turns argv into a shape
       * and would otherwise be the second place a default lives.
       */
      readonly at?: string;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
    }
  | ParsedDistill | ParsedSelect | ParsedShare
  | {
      readonly command: 'accept';
      readonly config: string;
      readonly subjects: readonly string[];
      readonly all: boolean;
      /** Difference shapes to accept wherever they are the whole change. */
      readonly shapes: readonly string[];
      /**
       * `--message-file <path>`: write the commit message explaining this update.
       *
       * A file rather than a commit, because whether these baselines are
       * committed — and to which branch, as whom — belongs to the workflow that
       * already decides it, not to the command that promotes images.
       */
      readonly messageFile?: string;
      /** `--message <text>`: the subject line of that message. */
      readonly message?: string;
    }
  | {
      readonly command: 'changelog';
      readonly config: string;
      /** `--component <text>`: substring, case-insensitive. */
      readonly component?: string;
      /** `--subject <id>`: exact, because a subject id is exact. */
      readonly subject?: string;
      readonly limit?: number;
      /** `--since <rev>`: read forward from this revision, exclusive. */
      readonly since?: string;
    }
  | {
      readonly command: 'journeys';
      readonly config: string;
      /**
       * `--all`: read every whole observation the snapshot holds.
       *
       * The default pool is the subjects the configured report names, because
       * the snapshot accumulates across runs and a subject deleted two commits
       * ago is still a party to every parting it was recorded in. This asks for
       * that record on purpose, which is a different question and has to look
       * like one.
       */
      readonly all: boolean;
      /** `--file <text>`: substring, case-insensitive, over the recorded module path. */
      readonly file?: string;
      readonly limit?: number;
      /** Shard snapshots to fold and land before reading, and `--into <path>`, where they land; this repository's cache otherwise. */
      readonly shards: readonly string[];
      readonly into?: string;
    }
  | {
      readonly command: 'adjudicate';
      readonly config: string;
      /** `--claims <path>`: the declaration. Required; there is no default intent. */
      readonly claims: string;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
      readonly exitZeroOnChanges: boolean;
    }
  | ParsedPush
  | { readonly command: 'watch' }
  | { readonly command: 'serve'; readonly config: string }
  | { readonly command: 'doctor'; readonly config: string }
  | {
      readonly command: 'comment';
      readonly config: string;
      readonly bodyFile?: string;
      readonly runUrl?: string;
      readonly marker: boolean;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
    }
  | { readonly command: 'help' }
  | { readonly command: 'version' };

export function parseArgs(argv: readonly string[]): Parsed {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help' };
  }

  // Before the command check, and answered by a flag rather than by a
  // subcommand: `--version` is what a person types into a tool they are about to
  // file a bug against, and it has to work when nothing else in the invocation
  // does.
  if (first === '--version' || first === '-v' || first === 'version') {
    return { command: 'version' };
  }

  if (!isCommand(first)) {
    throw new OperatorError(
      `unknown command \`${first}\`; this tool has ${COMMANDS.join(', ')}\n\n${USAGE}`,
    );
  }

  const flags = readFlags(argv.slice(1), first, flagsFor(first), USAGE);
  const config = resolve(flags.values.get('--config') ?? DEFAULT_CONFIG);

  switch (first) {
    case 'run': {
      const profile = flags.values.get('--profile');
      if (profile !== undefined && profile !== 'jsdom' && profile !== 'chromium') {
        throw new OperatorError(`--profile must be jsdom or chromium, not \`${profile}\``);
      }
      const subjects = flags.values.get('--subjects');
      const intent = flags.values.get('--intent');
      const runId = flags.values.get('--run');
      const commit = flags.values.get('--commit');
      const since = flags.values.get('--since');
      const against = flags.values.get('--against');
      noPositionals(flags.positionals, 'run');

      return {
        command: 'run',
        config,
        ...(profile !== undefined ? { profile } : {}),
        ...(subjects !== undefined ? { subjects } : {}),
        ...(intent !== undefined ? { intent } : {}),
        ...(runId !== undefined ? { run: runId } : {}),
        ...(commit !== undefined ? { commit } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(against !== undefined ? { against } : {}),
        flakes: flags.present.has('--flakes'),
        exitZeroOnChanges: flags.present.has('--exit-zero-on-changes'),
      };
    }

    case 'report': {
      const format = flags.values.get('--format') ?? 'text';
      if (format !== 'text' && format !== 'json' && format !== 'html') {
        throw new OperatorError(`--format must be text, json or html, not \`${format}\``);
      }
      const subject = flags.values.get('--subject');

      return {
        command: 'report',
        config,
        format,
        ...(subject !== undefined ? { subject } : {}),
        exitZeroOnChanges: flags.present.has('--exit-zero-on-changes'),
        // Named paths, not the configured one. A shard writes where its job told
        // it to, so `report` has to be able to read reports the config has never
        // heard of — and once it names them, adding the configured report to the
        // pile would merge in a file the operator did not ask for (ADR-0020).
        reports: flags.positionals.map((path) => resolve(path)),
      };
    }

    case 'ask': {
      // The first positional is the question and the rest are reports, which is
      // the same shape `report` already has with one word in front of it. A
      // `--question` flag would read as though the question were an option on
      // something else, and there is nothing else here.
      const [question, ...reports] = flags.positionals;
      const subjects = (flags.values.get('--subjects') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '');
      const subject = flags.values.get('--subject');
      const component = flags.values.get('--component');
      const rule = flags.values.get('--rule');
      const shape = flags.values.get('--shape');
      const claims = flags.values.get('--claims');
      const test = flags.values.get('--test');
      const state = flags.values.get('--state');
      const file = flags.values.get('--file');
      const query = flags.values.get('--query');
      const limit = countOf(flags.values.get('--limit'), 'tests to list');
      const at = flags.values.get('--at');

      return {
        command: 'ask',
        config,
        ...(question !== undefined ? { question } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(subjects.length > 0 ? { subjects } : {}),
        ...(component !== undefined ? { component } : {}),
        ...(rule !== undefined ? { rule } : {}),
        ...(shape !== undefined ? { shape } : {}),
        ...(claims !== undefined ? { claims: resolve(claims) } : {}),
        ...(test !== undefined ? { test } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(file !== undefined ? { file } : {}),
        ...(query !== undefined ? { query } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(at !== undefined ? { at } : {}),
        reports: reports.map((path) => resolve(path)),
      };
    }

    case 'distill': return parseDistill(flags);
    case 'select': return parseSelectArgs(flags);
    case 'share': return parseShareArgs(flags, config);

    case 'adjudicate': {
      const claims = flags.values.get('--claims');
      if (claims === undefined) {
        // No default, and no inference from the report. A declaration this
        // command invented would be one the author never made, and every arm of
        // the answer is about the distance between the two.
        throw new OperatorError(
          'adjudicate needs `--claims <path>`: what you meant to change, declared before the ' +
            'diff was read. Without it there is nothing to hold the run against and this would ' +
            'only repeat `variance report`.',
        );
      }

      return {
        command: 'adjudicate',
        config,
        claims: resolve(claims),
        reports: flags.positionals.map((path) => resolve(path)),
        exitZeroOnChanges: flags.present.has('--exit-zero-on-changes'),
      };
    }

    case 'accept': {
      const all = flags.present.has('--all');
      const shapes = (flags.values.get('--shape') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '');

      if (!all && shapes.length === 0 && flags.positionals.length === 0) {
        throw new OperatorError(
          'accept needs a subject id, --shape, or --all. Accepting nothing and accepting ' +
            'everything are different requests and this will not guess which was meant.',
        );
      }
      if (all && (flags.positionals.length > 0 || shapes.length > 0)) {
        // Refused rather than resolved in either direction: honouring --all would
        // silently accept subjects the operator did not name, and honouring the
        // names would silently ignore a flag they typed.
        throw new OperatorError(
          `--all accepts every changed subject, but ${[...flags.positionals, ...shapes].join(', ')} ` +
            'was also named; pass one or the other',
        );
      }
      if (shapes.length > 0 && flags.positionals.length > 0) {
        // A shape selects subjects. Naming subjects as well asks two different
        // questions at once, and every answer to it is somebody's surprise.
        throw new OperatorError(
          '--shape selects the subjects to accept by what changed in them, so naming ' +
            `${flags.positionals.join(', ')} as well is asking for two different sets`,
        );
      }
      const messageFile = flags.values.get('--message-file');
      const message = flags.values.get('--message');
      if (message !== undefined && messageFile === undefined) {
        // Refused rather than ignored. `--message` with nowhere to write it is a
        // workflow that believes it recorded an explanation and did not, which is
        // exactly the failure the message exists to prevent.
        throw new OperatorError(
          '--message is the subject line of the commit message --message-file writes, and ' +
            'no --message-file was given; this command never commits anything itself',
        );
      }

      return {
        command: 'accept',
        config,
        subjects: flags.positionals,
        all,
        shapes,
        ...(messageFile !== undefined ? { messageFile: resolve(messageFile) } : {}),
        ...(message !== undefined ? { message } : {}),
      };
    }

    case 'changelog': {
      noPositionals(flags.positionals, 'changelog');
      const component = flags.values.get('--component');
      const subject = flags.values.get('--subject');
      const since = flags.values.get('--since');
      const limit = countOf(flags.values.get('--limit'), 'commits to read');

      return {
        command: 'changelog',
        config,
        ...(component !== undefined ? { component } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(since !== undefined ? { since } : {}),
      };
    }

    case 'journeys': {
      const file = flags.values.get('--file');
      const limit = countOf(flags.values.get('--limit'), 'modules to name');
      const into = flags.values.get('--into');
      if (into !== undefined && flags.positionals.length === 0) {
        throw new OperatorError('`--into` says where a fold lands, and nothing was named to fold');
      }

      return {
        command: 'journeys',
        config,
        all: flags.present.has('--all'),
        ...(file !== undefined ? { file } : {}),
        ...(limit !== undefined ? { limit } : {}),
        shards: flags.positionals.map((path) => resolve(path)),
        ...(into !== undefined ? { into: resolve(into) } : {}),
      };
    }

    case 'push':
      return parsePushArgs(flags, config);

    // No config, because a watcher is not about a project. It listens, holds
    // what a suite says, and answers; none of that reads a subject list, a
    // baseline or a report path, and requiring one would put a watcher out of
    // reach in exactly the directories where somebody most wants to start one.
    case 'watch':
      noPositionals(flags.positionals, 'watch');
      return { command: 'watch' };

    case 'serve':
      noPositionals(flags.positionals, 'serve');
      return { command: 'serve', config };

    case 'doctor':
      noPositionals(flags.positionals, 'doctor');
      return { command: 'doctor', config };

    case 'comment': {
      const bodyFile = flags.values.get('--body-file');
      const runUrl = flags.values.get('--run-url');
      const marker = flags.present.has('--marker');

      if (marker && (bodyFile !== undefined || runUrl !== undefined || flags.positionals.length > 0)) {
        // Two different questions, and answering both at once would mean
        // deciding which one the exit code is about. `--marker` is a constant
        // this build carries; the body is a reading of a report that may not
        // exist yet.
        throw new OperatorError(
          '`--marker` prints the marker and nothing else; it does not take --body-file, ' +
            '--run-url or a report',
        );
      }

      return {
        command: 'comment',
        config,
        marker,
        ...(bodyFile !== undefined ? { bodyFile } : {}),
        // An empty `--run-url` is the workflow's "the operator published
        // nothing", which must read as absent rather than as a link to ''.
        ...(runUrl !== undefined && runUrl !== '' ? { runUrl } : {}),
        reports: flags.positionals.map((path) => resolve(path)),
      };
    }
  }
}
