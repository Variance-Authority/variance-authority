import type { Readable, Writable } from 'node:stream';
import type { EyesArchive } from '@variance-authority/eyes';
import type { RunReport } from '@variance-authority/report';
import {
  answering,
  createLineReader,
  handle,
  askedInput,
  askedTool,
  wantsTree,
  wellFormed,
  type JsonRpcRequest,
} from './framing.js';
import { readEyesRecord, RecordKeepsNoEyes } from './eyes-record.js';
import type { Served } from './tools/tool.js';
import type { Tree } from './tools/tree.js';

/**
 * The transport, and nothing else.
 *
 * Everything decidable lives in `protocol.ts` and `tools.ts`, both of which are
 * pure. What is left here is stream plumbing, which is the part that cannot be
 * unit-tested meaningfully and therefore the part that should contain no
 * decisions.
 *
 * What a started server reads — the served tool sets, the run report file, Eyes,
 * the live-run listener and the source tree — is imported by the function that
 * starts it, not by this module. The root entry exports `serve` beside pure
 * functions such as `locateSubjects`, and Node evaluates every static import of
 * an entry, so a static import here is paid by every caller that only wanted a
 * pure function and never starts a server.
 */

export interface ServerOptions<Subject = RunReport, Again extends AskedAgain<Subject> = AskedAgain<Subject>> {
  readonly input: Readable;
  readonly output: Writable;
  /** Which tools answer, and what the server calls itself. */
  readonly served: Served<Subject>;
  /**
   * Supplies the current subject.
   *
   * A function rather than a value so a long-lived server picks up a re-run
   * without a restart — an agent that fixes something and asks again should be
   * answered from the new report, not from the one loaded at boot.
   *
   * It may be async, and the request waits for it. A supplier that kicked off a
   * refresh and answered from the previous value would make *this* request the
   * stale one, which is the request that matters: the agent asking is the agent
   * that just re-ran.
   *
   * `input` is the arguments the call names, so a host whose subject is fetched
   * from somewhere — a deployment's decision history — fetches the window the
   * call asked for rather than all of it. Absent for anything but a call.
   */
  readonly subject: (asked?: string, input?: Readonly<Record<string, unknown>>) => Subject | Promise<Subject>;

  /**
   * How the subject is kept for the next request, where the default will not do.
   *
   * `previous` exists for the one tool that compares this request with the last
   * one, and the default — a structured clone of the whole subject — is right
   * while the subject is the thing being compared. A host answering over two
   * subjects at once is the case where it is not: a workspace's whole reading
   * would be cloned on every successful call to serve a comparison that only
   * ever looks at the report. So a host that carries more than it diffs says
   * here what is worth keeping.
   */
  readonly remember?: (subject: Subject) => Subject;

  /**
   * Supplies the source tree, for the calls that name a path.
   *
   * Separate from the subject and asked for separately, because it is a
   * different artifact read at a different cost. A report is a file; a tree is
   * a walk of a repository, so it is read when a call says it needs one and
   * never on the way past. `undefined` — or no supplier at all — is a host that
   * has no repository to read, and a start point is then refused rather than
   * resolved against something that is not a tree.
   */
  readonly tree?: () => Tree | undefined | Promise<Tree | undefined>;

  /** The checkout this server answers about, handed to every call as `invocation.root`. */
  readonly root?: string;

  /**
   * A subject to ask a refused call of once more, or none to let the refusal stand.
   *
   * A host whose subject is a reading it reuses — a workspace generation kept
   * for an hour — can refuse a name only because the reading is older than the
   * file that declares it. So a call to a tool the server has, with every
   * argument it requires, that came back `isError` is handed here with the
   * subject that refused it and when the request started. A `subject` read
   * since is asked the same call, and the tree is asked for again with it; a
   * `footer` ends the refusal that still stands, for a host that could not
   * bring its reading up to date and says why. Only a refusal pays for the
   * second reading.
   */
  readonly again?: (asked: string | undefined, refused: Subject, started: number) => Promise<Again | undefined>;

  /**
   * The answer a refused call gives instead of its refusal, or none to let the
   * refusal stand.
   *
   * A tool says some answers by throwing them — a name nothing declares is
   * thrown so that `again` reads the subject once more before the absence is
   * believed — and only its host knows which. So a call to a tool the server
   * has, with every argument it requires, still refused once `again` has had
   * its turn, is handed here with what its tool threw, the subject that refused
   * it last, and what `again` returned, as the host returned it; text returned
   * is the call's result, not an error, and `again`'s footer is the host's to
   * say in it. It runs whether or not the host passes `again`: a host that
   * reads its subject fresh for every call has nothing to read again, and its
   * thrown answers are answers all the same.
   */
  readonly answered?: (thrown: unknown, subject: Subject, again: Again | undefined) => string | undefined;
}

/** What a host answers a refused call with: a fresher subject, and what a refusal that still stands says. */
export interface AskedAgain<Subject> {
  readonly subject?: Subject;
  readonly footer?: string;
}

export function serve<Subject, Again extends AskedAgain<Subject> = AskedAgain<Subject>>(options: ServerOptions<Subject, Again>): () => void {
  const write = (value: unknown): void => {
    options.output.write(`${JSON.stringify(value)}\n`);
  };

  // Requests are answered in the order they arrived. JSON-RPC matches responses
  // by id and would tolerate any order, but a supplier that awaits makes the
  // ordering depend on how long each read took, and an interleaving that only
  // shows up under a slow disk is not a thing to debug later.
  let queue: Promise<void> = Promise.resolve();
  let previous: Subject | undefined;

  const read = createLineReader((line) => {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      // Unparseable input has no id, so there is nothing to answer. Answering
      // with a null id would be a second protocol violation on top of the first.
      return;
    }

    queue = queue.then(async () => {
      const started = Date.now();
      const asked = askedTool(request);
      const answer = async (subject: Subject) => {
        const tree = wantsTree(request, options.served) ? await options.tree?.() : undefined;
        return answering(request, () => subject, options.served, {
          ...(previous === undefined ? {} : { previous }),
          ...(tree === undefined ? {} : { tree }),
          ...(options.root === undefined ? {} : { root: options.root }),
        });
      };
      let subject: Subject = await options.subject(asked, askedInput(request));
      let answered = await answer(subject);
      let response = answered.response;
      if (!succeeded(response) && wellFormed(request, options.served)) {
        const fresher = await options.again?.(asked, subject, started);
        if (fresher?.subject !== undefined) {
          subject = fresher.subject;
          answered = await answer(subject);
          response = answered.response;
        }
        const said = response === null || answered.thrown === undefined ? undefined : options.answered?.(answered.thrown.value, subject, fresher);
        if (said !== undefined) response = { ...response!, result: { content: [{ type: 'text', text: said }] } };
        else if (fresher?.footer !== undefined) response = footed(response, fresher.footer);
      }
      if (request.method === 'tools/call' && succeeded(response)) {
        previous = options.remember === undefined ? structuredClone(subject) : options.remember(subject);
      }
      if (response !== null) write(response);
    });
  });

  const onData = (chunk: Buffer | string): void => read(chunk.toString());
  options.input.on('data', onData);

  return () => options.input.off('data', onData);
}

/** A refused call's result, ending with what the host said about the subject it was refused from. */
function footed(response: ReturnType<typeof handle>, footer: string): ReturnType<typeof handle> {
  if (response === null || response.error !== undefined || succeeded(response)) return response;
  const result = response.result as { readonly content: readonly { readonly type: string; readonly text: string }[]; readonly isError: true };
  const said = result.content.map((part) => part.text).join('\n');
  return { ...response, result: { ...result, content: [{ type: 'text', text: `${said}\n\n${footer}` }] } };
}

function succeeded(response: ReturnType<typeof handle>): boolean {
  if (response === null || response.error !== undefined) return false;
  return (response.result as { readonly isError?: boolean } | undefined)?.isError !== true;
}

/**
 * Where a report-file server reads and writes. Both default to this process's
 * stdio; they are parameters so the reload below is reachable from a test.
 */
export interface ReportFileOptions {
  readonly input?: Readable;
  readonly output?: Writable;
  /**
   * The repository the report was made in, for questions that name a path.
   *
   * A report says nothing about where its source is — it is a file, and it
   * travels. So the root arrives here, and where it does not, a question with a
   * start point in it is refused: answering it out of the paths the run
   * recorded would be answering a question about a tree from something that is
   * not one. A watcher reads a spec file a question names from here too, so a
   * path an agent's editor spelled from `/` is the name a reporter gave.
   */
  readonly root?: string;
  /** Where the scan index is kept, so a second question does not re-parse the tree. */
  readonly index?: string;
}

/**
 * The tree, read once and held.
 *
 * Read lazily, because most questions do not name a path and a walk of the
 * repository is not a thing to spend before anybody asked for one. Held after
 * the first read, because the alternative is paying for it on every question
 * that does. A failure is held too: a repository that could not be walked is
 * not going to become walkable between two requests of one session, and
 * retrying it silently would make every later answer slow for nothing.
 */
function treeOnce(options: ReportFileOptions): (() => Promise<Tree | undefined>) | undefined {
  const root = options.root;
  if (root === undefined) return undefined;

  let read: Promise<Tree | undefined> | undefined;
  return () => {
    read ??= import('./tools/tree.js').then(({ readTree }) =>
      readTree({ root, ...(options.index === undefined ? {} : { index: options.index }) })).catch(
      (error: unknown) => {
        // Said on stderr rather than swallowed. The refusal the caller reads is
        // about their question — *no source tree was read* — and the reason the
        // walk failed is about the setup, which is the operator's to see and not
        // the model's to be handed mid-answer.
        process.stderr.write(
          `variance: the source tree at \`${root}\` could not be read, so questions with a ` +
            `start point will be refused: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return undefined;
      },
    );
    return read;
  };
}

/**
 * Serve a report file, re-read before each request is answered.
 *
 * The reload is why `report` is a function, and awaiting it is why the answer is
 * current rather than one request behind. An agent that fixes something, re-runs,
 * and asks again is the whole reason this server outlives a single report — and
 * answering that agent from the copy loaded at boot tells it the edit did not
 * take, which is the one sentence here nobody should ever produce falsely.
 */
export async function serveReportFile(
  path: string,
  streams: ReportFileOptions = {},
): Promise<() => void> {
  const [{ readRunReport }, { REPORTS }] = await Promise.all([
    import('@variance-authority/report/file'),
    import('./protocol.js'),
  ]);
  // Read once before serving, so a path that is not a run report fails at
  // startup rather than on whichever request happens to arrive first.
  let cached = await readRunReport(path);

  const tree = treeOnce(streams);

  return serve({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
    served: REPORTS,
    ...(tree === undefined ? {} : { tree }),
    ...(streams.root === undefined ? {} : { root: streams.root }),
    subject: async () => {
      try {
        cached = await readRunReport(path);
      } catch {
        // A report that becomes unreadable mid-run — being rewritten, most
        // likely — must not take the server down. The previous one is stale,
        // not wrong.
      }
      return cached;
    },
  });
}

/**
 * Serve the Eyes journals a run kept in its record, on the same terms as a
 * report file.
 *
 * Same reload, same reason: the agent asking about a test's attention is
 * ordinarily the agent that just changed the component and re-ran, and answering
 * it from the record loaded at boot describes the run before the edit.
 *
 * `record` is the coverage record a recording run writes, `coverage.bin`; its
 * journals are read the way `variance distill` reads them. A record whose run
 * did not opt into Eyes is refused at startup; written later, it leaves no
 * journals to answer from.
 */
export async function serveEyesRecord(
  record: string,
  streams: ReportFileOptions = {},
): Promise<() => void> {
  const [{ createEyesArchive }, { EYES }] = await Promise.all([
    import('@variance-authority/eyes'),
    import('./protocol.js'),
  ]);
  let cached: EyesArchive = await readEyesRecord(record);

  return serve({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
    served: EYES,
    subject: async () => {
      try {
        cached = await readEyesRecord(record);
      } catch (error) {
        // A later run that did not opt into Eyes leaves no journals to answer
        // from, and the previous run's would describe the code before it.
        if (error instanceof RecordKeepsNoEyes) cached = createEyesArchive([]);
        // Otherwise mid-write, most likely. The previous record is stale, not
        // wrong, and taking the server down would lose the answer as well as
        // the update.
      }
      return cached;
    },
  });
}

/** A watcher that is listening, and the address a run must be started with. */
export interface ServedVantage {
  /** What to put in the run's environment, verbatim. */
  readonly address: string;
  readonly stop: () => Promise<void>;
}

/**
 * Serve a suite that has not finished.
 *
 * The subject is a **snapshot** rather than the store, and that is the whole of
 * why a live subject fits a surface built for files. A store is a thing a socket
 * writes into while an answer is being composed; a snapshot is a value, so every
 * tool here stays what every tool here is — a pure function over evidence — and
 * `variance_diff` gets a coherent previous state to compare against instead of
 * an object that changed underneath it.
 *
 * Nothing is written to disk, and nothing outlives this process. That is the
 * position `@variance-authority/event` takes about announcements, kept: what
 * changes is how long one execution lasts when somebody is watching it.
 */
export async function serveVantage(streams: ReportFileOptions = {}): Promise<ServedVantage> {
  const [{ attachVantage }, { VANTAGE }, { continuing }] = await Promise.all([
    import('@variance-authority/vantage/attach'),
    import('./protocol.js'),
    import('./tools/continue.js'),
  ]);
  const attached = await attachVantage();
  const stop = serve({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
    // The one served set assembled here rather than declared, because the one
    // tool that changes anything needs the thing it changes, and that exists
    // only once a watcher is listening.
    served: { ...VANTAGE, tools: [...VANTAGE.tools, continuing(attached.observatory)] },
    subject: () => attached.observatory.snapshot(),
    ...(streams.root === undefined ? {} : { root: streams.root }),
  });

  return {
    address: attached.address,
    stop: async () => {
      stop();
      await attached.close();
    },
  };
}
