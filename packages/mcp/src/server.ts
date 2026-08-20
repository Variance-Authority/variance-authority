import type { Readable, Writable } from 'node:stream';
import type { RunReport } from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';
import { createLineReader, handle, type JsonRpcRequest } from './protocol.js';

/**
 * The transport, and nothing else.
 *
 * Everything decidable lives in `protocol.ts` and `tools.ts`, both of which are
 * pure. What is left here is stream plumbing, which is the part that cannot be
 * unit-tested meaningfully and therefore the part that should contain no
 * decisions.
 */

export interface ServerOptions {
  readonly input: Readable;
  readonly output: Writable;
  /**
   * Supplies the current report.
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
  readonly report: () => RunReport | Promise<RunReport>;
}

export function serve(options: ServerOptions): () => void {
  const write = (value: unknown): void => {
    options.output.write(`${JSON.stringify(value)}\n`);
  };

  // Requests are answered in the order they arrived. JSON-RPC matches responses
  // by id and would tolerate any order, but a supplier that awaits makes the
  // ordering depend on how long each read took, and an interleaving that only
  // shows up under a slow disk is not a thing to debug later.
  let queue: Promise<void> = Promise.resolve();

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
      const report = await options.report();
      const response = handle(request, () => report);
      if (response !== null) write(response);
    });
  });

  const onData = (chunk: Buffer | string): void => read(chunk.toString());
  options.input.on('data', onData);

  return () => options.input.off('data', onData);
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
    report: async () => {
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
