import type { RunReport } from '@variance-authority/report';
import type { Tree } from './tree.js';
import type { SourceNames } from './names.js';
import type { BlockKind } from '@variance-authority/sense/instrument';

/**
 * The contract every tool implements, and the untyped boundary it sits behind.
 *
 * Its own module because every tool imports it and it imports no tool: an
 * interface that lives in the registry beside the list of tools makes each tool
 * depend on all the others, and nothing about that dependency is visible until
 * something loads in the wrong order.
 *
 * The subject is a type parameter rather than `RunReport`, because a tool is a
 * pure function from *something already read* to text, and nothing in that
 * sentence is about a report. It defaults to `RunReport` so the report tools
 * this package ships say nothing about it.
 *
 * `stringArg` is here for the same reason it exists at all. A tool is called with
 * whatever JSON a model produced, so `input` is `unknown` all the way down, and
 * the first thing any tool does with an argument is refuse it or narrow it. That
 * refusal is part of the contract, not a detail of whichever tool refuses first.
 */

export interface Tool<Subject = RunReport> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  run(
    subject: Subject,
    input: Readonly<Record<string, unknown>>,
    invocation?: ToolInvocation<Subject>,
  ): string;

  /**
   * Whether this call needs the source tree read before it runs.
   *
   * Asked of the tool rather than worked out by the host, because the host is
   * transport and the answer is about arguments. Reading the tree is a walk of
   * the repository, and a tool list where every call paid for one would tax
   * every question to serve the few that take a path — so `variance_locate`
   * says yes exactly when a start point was given, and no otherwise.
   *
   * Absent means never, which is what almost every tool here means.
   */
  wants?(input: Readonly<Record<string, unknown>>): boolean;

  /**
   * Every file this call answers with, uncapped, where its answer is a set of
   * files.
   *
   * `run` prints what a reader can take in, so it caps; a question asked as an
   * operand of another — the files two questions both answer — needs the whole
   * set, or the file it was asked to find can sit past the cap of either. So a
   * tool whose answer is files says which, from the same computation `run`
   * prints, and refuses what `run` refuses.
   *
   * Absent means the answer is not a set of files.
   */
  files?(
    subject: Subject,
    input: Readonly<Record<string, unknown>>,
    invocation?: ToolInvocation<Subject>,
  ): FileSet;

  /**
   * The modules this call names the regions of, by the probes that numbered
   * them, for the host to cut again from its checkout ahead of the call.
   *
   * A region arrives as an ordinal in a module's build, and its name and line
   * are in the file that build was made from. Reading that file is the host's,
   * as the walk of the tree is, and only a call that names regions pays for it.
   *
   * Absent means the answer names no region.
   */
  cuts?(subject: Subject, input: Readonly<Record<string, unknown>>): ReadonlyMap<string, readonly string[]>;
}

/** One region of a module the host cut again: where it sits, what it is called, and the line it was written on, if any. */
export interface CutRegion {
  readonly ordinal: number;
  /** The declaration's name path, `Cart/render`; empty on the module's own region. */
  readonly name: string;
  /** The structural path inside that declaration, `if#0/else`; empty on its entry. */
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  /** What the region is, where the host said: a story's route is drawn by it. */
  readonly kind?: BlockKind;
}

/** A module cut again. `instrumented` is false where the file is no longer the text its probes were placed on. */
export interface CutModule {
  readonly instrumented: boolean;
  readonly blocks: readonly CutRegion[];
}

/**
 * Every module a call asked for through {@link Tool.cuts}, by the probes that
 * numbered it and then by its id. Probes this build does not read have no
 * entry, and neither has a module whose file is gone.
 */
export type CutModules = ReadonlyMap<string, ReadonlyMap<string, CutModule>>;

/**
 * The files a question answers, each with the lines that put it there.
 *
 * An empty list of lines is a file in the set without one: a file a path
 * reaches is in it as a whole. `unread` names what the question could not read,
 * so a set that is short of files says so rather than reading as complete.
 */
export interface FileSet {
  readonly files: ReadonlyMap<string, readonly number[]>;
  readonly unread?: readonly string[];
}

/** What a host has already read, handed to a tool that cannot read anything itself. */
export interface ToolInvocation<Subject> {
  /** State held for exactly one previous invocation, by whatever is holding it. */
  readonly previous?: Subject;
  /**
   * The source tree, where the host could read one and the call asked for it.
   *
   * A tool is a pure function from something already read, and a path is a fact
   * about a tree that somebody has to walk. So the walk happens out here, ahead
   * of the call, and arrives as a value like the report does. Absent means no
   * tree was read, and a question that needed one is refused rather than
   * answered from something that is not a tree.
   */
  readonly tree?: Tree;
  /**
   * Every file's declared and imported names, read off the same scan as the
   * tree, where the host read them. Absent means none were read, and a question
   * that names a name is refused rather than answered as though no file had one.
   */
  readonly names?: SourceNames;
  /**
   * The modules the call asked to have cut, where the host had a checkout to
   * cut them from. Absent means none was read, and a region is then listed by
   * its file and counted, never named from a guess.
   */
  readonly modules?: CutModules;
  /**
   * Why the host could not compare this answer with what it is about, for the
   * line that dates it. Absent means nothing stood in the way.
   */
  readonly unseen?: string;
  /**
   * The checkout the host answers about, as the host was told it.
   *
   * Carried rather than guessed: a tool that opens what a checkout published —
   * its recording, its index — would otherwise read the process's working
   * directory, which is the host's launch site and not necessarily the root it
   * was started with. Absent means the host named none, and a tool that needs
   * one refuses rather than reading wherever the process happens to stand.
   */
  readonly root?: string;
  /**
   * The command a shell asks these tools through, such as `variance ask`, where
   * the host is a shell rather than the wire.
   *
   * An answer that tells its reader what to ask next names an input or another
   * tool, and the two surfaces spell them differently: the wire takes `from`
   * and `docs_symbol`, a shell takes `--from` and `variance ask symbol`. A hint
   * spelled for the other surface is one the reader cannot type. Absent means
   * the tools are asked over the wire, by the names their schemas publish.
   */
  readonly shell?: string;
}

/**
 * A set of tools, and what the server answering with them calls itself.
 *
 * The subject is a parameter because the protocol has no opinion about it. A run
 * report is one subject; a workspace's published API is another, and the framing
 * between a JSON-RPC line and a tool's text is identical for both. What differs
 * is the list and the name, and that is exactly what this holds.
 */
export interface Served<Subject = RunReport> {
  readonly name: string;
  readonly version: string;
  readonly tools: readonly Tool<Subject>[];
  /**
   * What a client puts in front of the model before it has called anything.
   *
   * A tool list says what each tool answers and cannot say when to reach for
   * one, and there is a class of server where that gap is the whole product: a
   * watcher nobody attached a run to lists tools about a run that does not
   * exist, reads as broken, and is never called again. So this takes the
   * subject — the one thing a set of tools cannot see at handshake time — and
   * anything it needs to say about **setup** goes here rather than into a tool
   * nobody has a reason to call yet.
   *
   * Omitted where a tool list is self-explanatory, which is the ordinary case:
   * a report on disk is already there, and nothing has to be arranged.
   */
  readonly instructions?: (subject: Subject) => string;
}

export const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

export function stringArg(input: Readonly<Record<string, unknown>>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`\`${name}\` is required and must be a non-empty string`);
  }
  return value;
}
