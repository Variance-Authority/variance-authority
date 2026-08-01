import type { Readable, Writable } from 'node:stream';
import { readRunReport, type RunReport } from './report.js';
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
   */
  readonly report: () => RunReport;
}

export function serve(options: ServerOptions): () => void {
  const write = (value: unknown): void => {
    options.output.write(`${JSON.stringify(value)}\n`);
  };

  const read = createLineReader((line) => {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      // Unparseable input has no id, so there is nothing to answer. Answering
      // with a null id would be a second protocol violation on top of the first.
      return;
    }

    const response = handle(request, options.report);
    if (response !== null) write(response);
  });

  const onData = (chunk: Buffer | string): void => read(chunk.toString());
  options.input.on('data', onData);

  return () => options.input.off('data', onData);
}

/**
 * Serve a report file over stdio, reloading it on each request.
 *
 * The reload is why `report` is a function. A run that finishes while an agent
 * is mid-conversation should change the answers, and an agent holding a stale
 * report will confidently report a regression it has already fixed.
 */
export async function serveReportFile(path: string): Promise<() => void> {
  let cached = await readRunReport(path);
  let loading = false;

  const refresh = (): void => {
    if (loading) return;
    loading = true;
    void readRunReport(path)
      .then((report) => {
        cached = report;
      })
      // A report that becomes unreadable mid-run — being rewritten, most likely
      // — must not take the server down. The previous one is stale, not wrong.
      .catch(() => undefined)
      .finally(() => {
        loading = false;
      });
  };

  return serve({
    input: process.stdin,
    output: process.stdout,
    report: () => {
      refresh();
      return cached;
    },
  });
}
