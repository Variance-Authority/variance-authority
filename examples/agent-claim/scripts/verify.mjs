import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI, answerOf, openServer } from './mcp-client.mjs';

/**
 * The claims this example's README makes, checked against the shipped binaries.
 *
 * The demo prints; this decides. They are separate on purpose — the printed run
 * is *for* an agent and must stay readable, and a file that both narrates and
 * asserts ends up doing neither well.
 *
 * What is checked here is the half a pure unit test cannot reach. `handle` is a
 * function and every decision it makes is asserted by calling it; what needs two
 * processes and a pipe is a frame split where the OS split it, a notification
 * that must produce no line at all, and a report rewritten under an open
 * session. Those are transport claims, and the transport is the part an agent
 * actually meets.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REPORT = join(ROOT, '.variance', 'run.json');

const results = [];

function check(name, holds, detail) {
  results.push({ name, holds, detail });
  console.log(`${holds ? '  ok  ' : ' FAIL '} ${name}`);
  if (!holds && detail !== undefined) {
    for (const line of String(detail).split('\n')) console.log(`        ${line}`);
  }
}

const claimsFile = JSON.parse(readFileSync(join(ROOT, 'claims.json'), 'utf8'));

// ---------------------------------------------------------------------------

const cli = spawnSync(
  process.execPath,
  [CLI, 'adjudicate', '--config', 'variance.config.json', '--claims', 'claims.json'],
  { cwd: ROOT, encoding: 'utf8' },
);

const server = openServer();
const original = readFileSync(REPORT, 'utf8');

try {
  await server.call('initialize', { protocolVersion: '2024-11-05', capabilities: {} });

  const overMcp = answerOf(
    await server.call('tools/call', {
      name: 'variance_adjudicate',
      arguments: { claims: claimsFile.claims },
    }),
  );

  // An agent and a person asking the same question must be told the same thing.
  // Two renderings of one adjudication is how they drift: the flag grows a
  // sentence the tool never learned, and the two surfaces start disagreeing
  // about a run neither of them re-read.
  check(
    'the CLI and the MCP tool answer the same claims identically',
    cli.stdout.trim() === overMcp.trim(),
    `cli:\n${cli.stdout.trim()}\n\nmcp:\n${overMcp.trim()}`,
  );

  check('adjudicate exits 1 when a run needs review', cli.status === 1, `exit ${cli.status}`);

  // A stdio chunk boundary falls where the OS puts it. Getting the framing wrong
  // produces a parse error under load and never in a test that writes whole
  // lines, so this one is written in halves on purpose.
  const framed = JSON.stringify({
    jsonrpc: '2.0',
    id: 9001,
    method: 'tools/call',
    params: { name: 'variance_summary', arguments: {} },
  });
  const reply = server.awaitReply(9001);
  server.writeRaw(framed.slice(0, 17));
  server.writeRaw(`${framed.slice(17)}\n`);
  const split = await Promise.race([
    reply,
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  check(
    'a request split across two writes is still answered',
    split !== null && split.result !== undefined,
    split === null ? 'no answer within 5s' : JSON.stringify(split).slice(0, 200),
  );

  // A notification that gets answered is a protocol violation, and one this
  // client would never notice: it only reads replies it is waiting for.
  const before = server.unsolicited.length;
  server.notify('tools/list', {});
  await server.call('ping', {});
  check(
    'a notification is not answered',
    server.unsolicited.length === before,
    JSON.stringify(server.unsolicited.slice(before)),
  );

  // The two failure kinds are deliberately different, and the difference is the
  // product: a transport error is invisible to a model, while an error *result*
  // is text it can read and correct from.
  const unknownTool = await server.call('tools/call', { name: 'variance_nonsense', arguments: {} });
  check(
    'an unknown tool is a transport error',
    unknownTool.error?.code === -32602,
    JSON.stringify(unknownTool),
  );

  const unknownSubject = await server.call('tools/call', {
    name: 'variance_describe',
    arguments: { subject: 'card/nonexistent' },
  });
  check(
    'an unknown subject is a readable result, not a transport error',
    unknownSubject.error === undefined &&
      unknownSubject.result.isError === true &&
      /card\/summary/.test(answerOf(unknownSubject)),
    JSON.stringify(unknownSubject).slice(0, 300),
  );

  // The claim `serveReportFile` makes in its own docstring: an agent that fixes
  // something and asks again is answered from the new report. So rewrite the
  // report under the open session and count how many requests it takes.
  const report = JSON.parse(original);
  writeFileSync(
    REPORT,
    JSON.stringify({
      ...report,
      observations: report.observations.filter((o) => o.subject !== 'badge/standalone'),
      composition: {
        ...report.composition,
        subjects: report.composition.subjects.filter((s) => s.subject !== 'badge/standalone'),
        components: report.composition.components.filter((c) => c.component !== 'Badge'),
      },
    }),
  );

  const asked = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    asked.push(
      answerOf(
        await server.call('tools/call', {
          name: 'variance_adjudicate',
          arguments: { claims: [{ root: 'component:Badge', reason: 'new brand accent' }] },
        }),
      ),
    );
  }

  const changedAt = asked.findIndex((answer) => /unobservable|never rendered/.test(answer));
  check(
    'a report rewritten mid-session changes the next answer',
    changedAt === 0,
    changedAt === -1
      ? `four requests later the server still answers from the old report:\n${asked[3]}`
      : `the answer changed on request ${changedAt + 1}, not the first:\n${asked[0]}`,
  );
} finally {
  writeFileSync(REPORT, original);
  server.close();
}

const failed = results.filter((result) => !result.holds);
console.log(`\n${results.length - failed.length}/${results.length} claims hold.`);
process.exit(failed.length === 0 ? 0 : 1);
