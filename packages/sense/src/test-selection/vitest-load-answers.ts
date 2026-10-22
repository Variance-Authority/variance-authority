/**
 * The process that holds a Vitest configuration answers its workers for every
 * file Node loads in them past Vite's module runner: whether the run takes it,
 * and the probed text to evaluate in its place.
 *
 * `include` and `unprobed` are functions of the configuration, and no worker is
 * handed them, so the question crosses to this process the way a Vite
 * transform's does. The worker's side is `answeredBy` in `node-loads.cts`.
 */

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heldOriginal, type Captured } from './captured-modules.js';
import { mayTake } from './instrumented-modules.js';
import type { SelectionRun } from './selection-run.js';

/** Where the workers ask, and the end of answering them. */
export interface LoadAnswers {
  /** A Unix socket, or a named pipe on Windows. */
  readonly address: string;
  /** What a setup module evaluates to hook its worker's loads and ask here, before any test file loads. */
  readonly asking: string;
  /** Stop answering, and remove the socket. Called again, it does nothing. */
  readonly close: () => void;
}

/** A file named alone asks whether the run takes it; with its text, what to evaluate. */
interface Question {
  readonly file: string;
  readonly code?: string;
}

type Reply = { readonly take: boolean } | { readonly code: string | null } | { readonly error: string };

/**
 * Answer the workers of a run, probing a file `capture` takes and adding its
 * module to `run.modules`, as the transform does for what Vite evaluates.
 * `takes` is the configuration's own `include` or `unprobed`, as the transform
 * asks them. A file whose text no longer matches the file on disk is refused
 * with `refusal`.
 */
export function answerLoads(
  run: Pick<SelectionRun, 'modules'>,
  takes: (file: string) => boolean,
  capture: (file: string, code: string, original: (at: string) => string) => Captured | undefined,
  refusal: (file: string) => Error,
): LoadAnswers {
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\variance-authority-${randomUUID()}`
    : join(tmpdir(), `va-${randomUUID().slice(0, 8)}.sock`);
  const reply = (question: Question): Reply => {
    if (question.code === undefined) {
      return { take: mayTake(question.file, takes) };
    }
    const captured = capture(question.file, question.code, heldOriginal(question.file, undefined));
    if (captured === undefined) return { code: null };
    if (captured.changed === true) return { error: refusal(question.file).message };
    run.modules.set(captured.module.id, captured.module);
    return { code: captured.code };
  };
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let pending = '';
    socket.on('data', (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        socket.write(`${JSON.stringify(answered(line, reply))}\n`);
      }
    });
    // A worker that ends mid-question has nobody left to answer.
    socket.on('error', () => socket.destroy());
  });
  server.on('error', (error) => {
    throw new Error(`variance-authority could not answer Node's loads at ${address}: ${error.message}`, { cause: error });
  });
  server.listen(address);
  server.unref();
  listening.add(address);
  let closed = false;
  return {
    address,
    asking: `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(import.meta.url)})('./node-loads.cjs')` +
      `.answeredBy(${JSON.stringify(address)}, globalThis);\n`,
    close: () => {
      if (closed) return;
      closed = true;
      server.close();
      listening.delete(address);
      remove(address);
    },
  };
}

/** The sockets this process still listens on, removed when it exits however it ends. */
const listening = new Set<string>();
process.once('exit', () => listening.forEach(remove));

function remove(address: string): void {
  if (process.platform !== 'win32') rmSync(address, { force: true });
}

/** A worker waits on every answer, so a failure to probe is an answer too, said in the worker that loads the file. */
function answered(line: string, reply: (question: Question) => Reply): Reply {
  try {
    return reply(JSON.parse(line) as Question);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
