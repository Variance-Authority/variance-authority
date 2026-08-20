import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A client for the stdio server, because that is the only way to exercise it.
 *
 * `handle` is a pure function and every decision it makes is asserted by calling
 * it. What that cannot reach is the half between: a chunk boundary landing where
 * the OS put it, a notification that must produce no line at all, and a report
 * being rewritten under a session that is already open. Those need two processes
 * and a pipe.
 *
 * It is this repository's own implementation of the wire and not an independent
 * one, so it proves the transport works, not that it matches somebody else's
 * reading of the spec. `packages/mcp/src/protocol.ts` states the same trade for
 * the server half.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');

export const CLI = join(PACKAGE_ROOT, '..', '..', 'packages', 'cli', 'dist', 'bin.js');

export function openServer(argv = ['serve', '--config', 'variance.config.json']) {
  const server = spawn(process.execPath, [CLI, ...argv], {
    cwd: PACKAGE_ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const pending = new Map();
  const unsolicited = [];
  let buffer = '';

  server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() === '') continue;

      const message = JSON.parse(line);
      const waiting = pending.get(message.id);
      if (waiting === undefined) {
        // Kept rather than dropped: a line nobody asked for is the failure a
        // client that only reads its own replies can never report.
        unsolicited.push(message);
        continue;
      }
      pending.delete(message.id);
      waiting(message);
    }
  });

  let id = 0;

  /** Send one request and resolve with its response. */
  const call = (method, params) => {
    id += 1;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  /** Send a request with no `id`. A conforming server answers nothing. */
  const notify = (method, params) => {
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  /** Write bytes exactly as given, so a caller can split a frame on purpose. */
  const writeRaw = (text) => {
    server.stdin.write(text);
  };

  /** Await a reply to a request written by hand, by the id it carries. */
  const awaitReply = (replyTo) =>
    new Promise((resolve) => {
      pending.set(replyTo, resolve);
    });

  const close = () => {
    server.stdin.end();
    server.kill();
  };

  return { call, notify, writeRaw, awaitReply, unsolicited, close };
}

/** The text of a `tools/call` answer, or the error that came back instead. */
export function answerOf(response) {
  if (response.error !== undefined) return `[error ${response.error.code}] ${response.error.message}`;
  return response.result.content.map((part) => part.text).join('\n');
}
