import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Captured } from './captured-modules.js';
import { answerLoads, type LoadAnswers } from './node-load-answers.js';

// What a worker hears back for each file its Node loads past Vite: whether the
// run takes it, and the text to evaluate. Asked over the socket, line by line,
// as `node-loads.cts` asks.

const opened: LoadAnswers[] = [];

afterEach(() => {
  for (const answers of opened.splice(0)) answers.close();
});

const module = (file: string) => ({ id: `${file}@1`, file }) as unknown as Captured['module'];

function answering(capture: (file: string, code: string) => Captured | undefined) {
  const modules = new Map<string, Captured['module']>();
  const answers = answerLoads(
    { modules },
    (file) => file.startsWith('/repo/src/'),
    capture,
    (file) => new Error(`${file} changed`),
  );
  opened.push(answers);
  return { answers, modules };
}

/** Each line sent, and the line answered to it, in order. */
async function ask(address: string, lines: readonly string[]): Promise<unknown[]> {
  const socket = connect(address);
  socket.setEncoding('utf8');
  let received = '';
  const replies = new Promise<unknown[]>((done, fail) => {
    socket.on('error', fail);
    socket.on('data', (chunk: string) => {
      received += chunk;
      const answered = received.split('\n').slice(0, -1);
      if (answered.length === lines.length) {
        socket.end();
        done(answered.map((line) => JSON.parse(line) as unknown));
      }
    });
  });
  socket.write(lines.map((line) => `${line}\n`).join(''));
  return replies;
}

describe('the answers to what a worker loads through Node', () => {
  it('takes what the configuration takes, and no dependency it does not', async () => {
    const { answers } = answering(() => undefined);
    const replies = await ask(answers.address, [
      JSON.stringify({ file: '/repo/src/add.cjs' }),
      JSON.stringify({ file: '/repo/node_modules/left-pad/index.js' }),
    ]);
    expect(replies).toEqual([{ take: true }, { take: false }]);
  });

  it('answers a taken file with its probed text, and adds its module to the run', async () => {
    const { answers, modules } = answering((file, code) => ({ module: module(file), code: `probed ${code}` }));
    const replies = await ask(answers.address, [JSON.stringify({ file: '/repo/src/add.cjs', code: 'add' })]);
    expect(replies).toEqual([{ code: 'probed add' }]);
    expect([...modules.keys()]).toEqual(['/repo/src/add.cjs@1']);
  });

  it('answers `null` for a file nothing was placed on', async () => {
    const { answers, modules } = answering(() => undefined);
    expect(await ask(answers.address, [JSON.stringify({ file: '/repo/src/add.cjs', code: 'add' })])).toEqual([{ code: null }]);
    expect(modules.size).toBe(0);
  });

  it('refuses a file whose text is not the file on disk, and records nothing of it', async () => {
    const { answers, modules } = answering((file, code) => ({ module: module(file), code, changed: true }));
    const replies = await ask(answers.address, [JSON.stringify({ file: '/repo/src/add.cjs', code: 'add' })]);
    expect(replies).toEqual([{ error: '/repo/src/add.cjs changed' }]);
    expect(modules.size).toBe(0);
  });

  it('answers a question it cannot read with the reason, so the worker waiting on it throws', async () => {
    const { answers } = answering(() => undefined);
    const [reply] = await ask(answers.address, ['{']);
    expect(reply).toEqual({ error: expect.stringMatching(/JSON/) });
  });

  it.runIf(process.platform !== 'win32')('removes its socket when closed', () => {
    const { answers } = answering(() => undefined);
    answers.close();
    expect(existsSync(answers.address)).toBe(false);
  });
});
