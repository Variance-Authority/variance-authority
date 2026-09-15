import type { Readable, Writable } from 'node:stream';
import type { EyesArchive } from '@variance-authority/eyes';
import { readEyesArchive } from '@variance-authority/eyes/archive';
import type { RunReport } from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';
import { attachVantage } from '@variance-authority/vantage/attach';
import {
  EYES,
  REPORTS,
  VANTAGE,
  createLineReader,
  handle,
  type JsonRpcRequest,
} from './protocol.js';
import { continuing } from './tools/continue.js';
import type { Served } from './tools/tool.js';

/**
 * The transport, and nothing else.
 *
 * Everything decidable lives in `protocol.ts` and `tools.ts`, both of which are
 * pure. What is left here is stream plumbing, which is the part that cannot be
 * unit-tested meaningfully and therefore the part that should contain no
 * decisions.
 */

export interface ServerOptions<Subject = RunReport> {
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
   */
  readonly subject: () => Subject | Promise<Subject>;
}

export function serve<Subject>(options: ServerOptions<Subject>): () => void {
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
      const subject = await options.subject();
      const response = handle(
        request,
        () => subject,
        options.served,
        previous === undefined ? {} : { previous },
      );
      if (request.method === 'tools/call' && succeeded(response)) {
        previous = structuredClone(subject);
      }
      if (response !== null) write(response);
    });
  });

  const onData = (chunk: Buffer | string): void => read(chunk.toString());
  options.input.on('data', onData);

  return () => options.input.off('data', onData);
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
  // Read once before serving, so a path that is not a run report fails at
  // startup rather than on whichever request happens to arrive first.
  let cached = await readRunReport(path);

  return serve({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
    served: REPORTS,
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
 * Serve the archive a run produced, on the same terms as a report file.
 *
 * Same reload, same reason: the agent asking about a test's attention is
 * ordinarily the agent that just changed the component and re-ran, and answering
 * it from the archive loaded at boot describes the run before the edit.
 *
 * The archive is what `@variance-authority/eyes`'s `gatherEyesArchive` folds a
 * run's per-test journals into — one file, written when the run ended. A journal
 * *directory* is deliberately not accepted here: gathering mid-run would serve
 * an archive missing whichever workers had not finished, and an agent cannot
 * tell that from a suite whose remaining tests looked at nothing.
 */
export async function serveEyesArchive(
  path: string,
  streams: ReportFileOptions = {},
): Promise<() => void> {
  let cached: EyesArchive = await readEyesArchive(path);

  return serve({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
    served: EYES,
    subject: async () => {
      try {
        cached = await readEyesArchive(path);
      } catch {
        // Mid-write, most likely. The previous archive is stale, not wrong, and
        // taking the server down would lose the answer as well as the update.
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
  const attached = await attachVantage();
  const stop = serve({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
    // The one served set assembled here rather than declared, because the one
    // tool that changes anything needs the thing it changes, and that exists
    // only once a watcher is listening.
    served: { ...VANTAGE, tools: [...VANTAGE.tools, continuing(attached.observatory)] },
    subject: () => attached.observatory.snapshot(),
  });

  return {
    address: attached.address,
    stop: async () => {
      stop();
      await attached.close();
    },
  };
}
