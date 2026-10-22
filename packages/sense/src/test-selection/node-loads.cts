/**
 * What a test process loads through Node itself rather than through a runner's
 * transform, and the probes placed on it.
 *
 * Two seams meet Node's loader. `registerRecording` instruments a runner that
 * has no transform of its own, deciding each file in the process that loads
 * it. Vitest transforms what its module runner evaluates, and hands every
 * CommonJS module a `require` of Node's, so a `require` chain — and a
 * dependency it leaves to Node — reaches no transform: the worker asks the
 * process that holds the configuration, whose `include` is a function no
 * worker can be handed, and evaluates what it answers.
 *
 * CommonJS, because the Vitest setup module reaches it with `createRequire`
 * from a worker with no resolution root, as it reaches `collectors.cts`.
 */

import nodeModule = require('node:module');
import url = require('node:url');
import threads = require('node:worker_threads');

type ModuleHooks = nodeModule.ModuleHooks;

/** The formats Node evaluates from source text; `json`, `wasm`, `builtin` and `addon` are not. */
const EVALUATED = new Set(['module', 'commonjs', 'module-typescript', 'commonjs-typescript']);

/**
 * Hook every module Node loads from a file and evaluates as source, and
 * evaluate what `place` answers for it in its place; `undefined` leaves it as
 * it loaded. `text` is read only when asked, and TypeScript arrives as written,
 * for Node to strip after.
 */
function hookLoads(place: (file: string, text: () => string) => string | undefined): ModuleHooks {
  return nodeModule.registerHooks({
    load(at, context, nextLoad) {
      const loaded = nextLoad(at, context);
      if (!at.startsWith('file:') || loaded.source === undefined || loaded.source === null) return loaded;
      if (!EVALUATED.has(loaded.format ?? '')) return loaded;
      const source = loaded.source;
      const placed = place(url.fileURLToPath(at), () => textOf(source));
      return placed === undefined ? loaded : { ...loaded, source: placed };
    },
  });
}

/** A loaded module's source as text, however the loader handed it over. */
function textOf(source: string | ArrayBuffer | NodeJS.TypedArray): string {
  return typeof source === 'string' ? source : new TextDecoder().decode(source);
}

/** What the answering process says to a file named alone, and to a file with its text. */
type Answer = { readonly take: boolean } | { readonly code: string | null } | { readonly error: string };

/** Where this realm was told to ask, so a second setup module evaluated in it asks nothing twice. */
const ASKING = Symbol.for('variance-authority.test-selection.node-loads');

/**
 * Hook what Node loads in this worker, asking `address` — the socket
 * `answerLoads` listens on — for each file: first whether the run takes it,
 * then, with its text, what to evaluate.
 *
 * `realm` is the global the probes report into. A pool that evaluates test
 * files in a context of their own leaves Node's modules in another one, where
 * no collector is installed, and is not hooked.
 */
function answeredBy(address: string, realm: object): void {
  // FIXME: `vmThreads` and `vmForks` land here, and a `require` chain under them goes unrecorded.
  if (realm !== globalThis) return;
  const carrier = globalThis as { [ASKING]?: string };
  if (carrier[ASKING] !== undefined) return;
  carrier[ASKING] = address;
  const ask = asking(address);
  hookLoads((file, text) => {
    const asked = ask({ file });
    if (!('take' in asked) || !asked.take) return failed(asked);
    const answer = ask({ file, code: text() });
    return answer.code ?? undefined;
  });
}

/** `undefined` for a file the run does not take; a thrown error for one the answering process refused. */
function failed(answer: Answer): undefined {
  if ('error' in answer) throw new Error(answer.error);
  return undefined;
}

/**
 * A synchronous question to `address`, as a module hook has to ask it.
 *
 * A thread of the worker's own holds the socket, and the worker waits on a
 * shared word until that thread has posted the answer: the way `synckit` turns
 * an asynchronous call into a synchronous one, and Node its own off-thread
 * module hooks.
 */
function asking(address: string): (question: object) => Answer & { readonly code?: string | null } {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new threads.MessageChannel();
  const thread = new threads.Worker(ASKER, { eval: true, workerData: { address, signal, port: port2 }, transferList: [port2] });
  thread.unref();
  return (question) => {
    Atomics.store(signal, 0, 0);
    port1.postMessage(question);
    Atomics.wait(signal, 0, 0);
    const received = threads.receiveMessageOnPort(port1);
    if (received === undefined) throw new Error(`variance-authority asked ${address} and was not answered`);
    return received.message as Answer;
  };
}

/** The thread that holds the socket: one question out per line, one answer back per line. */
const ASKER = `
const { connect } = require('node:net');
const { workerData } = require('node:worker_threads');
const { address, signal, port } = workerData;
// One question is out at a time, and the worker waits on it until answered.
let asked = false;
const answer = (message) => {
  asked = false;
  port.postMessage(message);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
};
const socket = connect(address);
socket.setEncoding('utf8');
let pending = '';
socket.on('data', (chunk) => {
  pending += chunk;
  let end;
  while ((end = pending.indexOf('\\n')) !== -1) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    try {
      answer(JSON.parse(line));
    } catch (error) {
      answer({ error: 'variance-authority was answered what it cannot read from ' + address + ': ' + error.message });
    }
  }
});
// Once the socket is gone every question is answered with why, the one in flight first.
let broken;
const lost = (reason) => {
  if (broken !== undefined) return;
  broken = { error: 'variance-authority lost ' + address + ': ' + reason };
  if (asked) answer(broken);
};
socket.on('error', (error) => lost(error.message));
socket.on('close', () => lost('the process that answers closed it'));
port.on('message', (question) => {
  if (broken !== undefined) return answer(broken);
  asked = true;
  socket.write(JSON.stringify(question) + '\\n');
});
`;

export = { hookLoads, answeredBy };
