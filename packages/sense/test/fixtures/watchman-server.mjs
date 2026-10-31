// A Watchman server that answers from a file, over Watchman's JSON protocol.
//
// The update's client is the code under test; the server is the part a test
// cannot ask CI to run. `answers` is read on every request, so a test changes
// what the next query reports by rewriting it, and every request is appended
// to `requests` as one JSON line.
//
//   node watchman-server.mjs <socket> <answers.json> <requests.log>

import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';

const [socket, answers, requests] = process.argv.slice(2);

/** The part of Watchman's expression language the client speaks, over `{ name, type }`; a bare name is a file. */
function matches(expression, file) {
  const [term, ...operands] = expression;
  const { name, type = 'f' } = typeof file === 'string' ? { name: file } : file;
  switch (term) {
    case 'allof':
      return operands.every((operand) => matches(operand, file));
    case 'not':
      return !matches(operands[0], file);
    case 'type':
      return type === operands[0];
    case 'dirname':
      return name.startsWith(`${operands[0]}/`);
    default:
      throw new Error(`the fixture does not speak ${term}`);
  }
}

const named = (file) => (typeof file === 'string' ? file : file.name);

function answer(command) {
  const told = JSON.parse(readFileSync(answers, 'utf8'));
  const [name, root] = command;
  switch (name) {
    case 'watch-list':
      return { roots: told.roots };
    case 'clock':
      return told.roots.includes(root) ? { clock: told.clock } : { error: `unable to resolve root ${root}` };
    case 'get-config':
      return { config: told.config ?? {} };
    case 'query':
      if (!told.roots.includes(root)) return { error: `unable to resolve root ${root}` };
      const { expression } = command[2];
      const files = (told.files ?? []).filter((file) => expression === undefined || matches(expression, file));
      return { clock: told.clock, is_fresh_instance: told.fresh ?? false, files: files.map(named) };
    default:
      return { error: `unknown command ${name}` };
  }
}

createServer((connection) => {
  let pending = '';
  connection.on('data', (chunk) => {
    pending += chunk;
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      const command = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      appendFileSync(requests, `${JSON.stringify(command)}\n`);
      connection.write(`${JSON.stringify({ version: 'fixture', ...answer(command) })}\n`);
    }
  });
}).listen(socket, () => process.stdout.write('ready\n'));
