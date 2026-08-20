import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentBundle } from './agent-bundle.mjs';

/**
 * The run an agent would perform on itself, performed where it can be read.
 *
 * Three steps, in the order the boundary is meant to be used: observe the
 * branch, hand back what you said you were doing, and then do the same thing
 * over MCP — because an agent talks to this through a tool call, and a surface
 * that only works from a shell is a surface an agent does not have.
 *
 * The claims are written *before* anything here looks at a diff. That is the
 * only thing keeping the adjudication from scoring the run against itself, and
 * it is not enforceable from inside the tool: what the tool can do is never
 * derive a claim, which it doesn't.
 *
 * Nothing here asserts. It prints, because the audience is whoever — or
 * whatever — is reading the output and deciding what to edit next.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, '..', '..', 'packages', 'cli', 'dist', 'bin.js');

const EXIT = {
  0: 'nothing needs review',
  1: 'changes need review',
  2: 'operator error — the run itself was wrong',
};

function variance(argv) {
  console.log(`\n$ variance ${argv.join(' ')}\n`);

  const result = spawnSync(process.execPath, [CLI, ...argv], { cwd: ROOT, encoding: 'utf8' });

  process.stdout.write(result.stdout ?? '');
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`\n[exit ${result.status}: ${EXIT[result.status] ?? 'unknown'}]`);

  return result.status;
}

/**
 * The same question through the surface an agent actually has.
 *
 * One claim carries a `bands` field this resolution cannot check — a run report
 * keeps no band per change — so the answer names it instead of dropping it. An
 * agent told `delivered` about a band nothing looked at has been told something
 * the run never established.
 */
async function overMcp() {
  console.log('\n$ variance serve --config variance.config.json   # MCP over stdio\n');

  const server = spawn(process.execPath, [CLI, 'serve', '--config', 'variance.config.json'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const pending = new Map();
  let buffer = '';
  server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() === '') continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });

  let id = 0;
  const call = (method, params) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

    const listed = await call('tools/list', {});
    console.log(`tools/list → ${listed.result.tools.map((tool) => tool.name).join(', ')}\n`);

    const answer = await call('tools/call', {
      name: 'variance_adjudicate',
      arguments: {
        claims: [
          {
            root: 'component:Button',
            reason: 'new brand accent on the primary action',
            maxSubjects: 1,
            bands: ['paint'],
          },
          { root: 'component:Card', reason: 'tighten the gap between the avatar and the action' },
        ],
      },
    });

    console.log('tools/call variance_adjudicate →\n');
    for (const part of answer.result.content) console.log(part.text);
  } finally {
    server.stdin.end();
    server.kill();
  }
}

await buildAgentBundle();

variance(['run', '--config', 'variance.config.json']);
variance(['adjudicate', '--config', 'variance.config.json', '--claims', 'claims.json']);
await overMcp();
