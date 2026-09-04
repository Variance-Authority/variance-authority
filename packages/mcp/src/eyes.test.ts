import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createEyesLog,
  eyesTestAttention,
  type EyesArchive,
  type EyesLog,
  type TargetSnapshot,
} from '@variance-authority/eyes';
import { parseEyesArchive, readEyesArchive } from '@variance-authority/eyes/archive';
import {
  gatherEyesArchive,
  recordEyesTest,
  writeEyesArchive,
} from '@variance-authority/eyes/collect';
import { serveEyesArchive } from './server.js';
import { eyesToolByName } from './tools.js';

/**
 * The tool answering from a file a run wrote, rather than from a literal.
 *
 * `attention.test.ts` hands the tool an archive constructed in the test, which
 * says the formatter is right and nothing about whether an archive can get here.
 * This starts at the log a test records into and ends at a JSON-RPC response, so
 * the two ends are held to the same file: a producer that emitted a shape the
 * reader refuses fails here, and so does a server pointed at an archive nothing
 * ever wrote.
 */

const BUTTON: TargetSnapshot = {
  nodeName: 'button',
  role: 'button',
  ariaLabel: 'Redraw',
  provenance: {
    status: 'resolved',
    provenance: {
      owners: [{ name: 'DrawingPanel', propsDigest: 'props' }],
      createdBy: 'RedrawButton',
      source: { file: 'src/drawing/RedrawButton.tsx', line: 17, column: 5 },
    },
  },
};

/** What a watched screen puts in a log while a test arranges, acts and asserts. */
function recorded(log: EyesLog): void {
  // Every RTL journal opens with this unless a setup file installed React's
  // commit hook first, so a reader that cannot describe it cannot describe an
  // ordinary run.
  log.record({ kind: 'react-tap-refused', reason: 'no-hook' });
  log.phase('arrange');
  log.record({
    kind: 'rtl-query',
    query: 'getByRole',
    arguments: ['button', { name: 'Redraw' }],
    outcome: 'resolved',
    targets: [BUTTON],
  });
  log.phase('act');
  log.record({ kind: 'document-event', event: 'click', trusted: false, target: BUTTON });
}

/** A run of one test, from an empty log to the file an agent is pointed at. */
async function produced(directory: string, log: EyesLog, because?: string): Promise<string> {
  await recordEyesTest(
    directory,
    eyesTestAttention(
      { id: 'redraw-test', title: 'redraws the canvas', file: 'test/drawing.test.tsx' },
      log.drain(),
      because,
    ),
  );
  const path = join(directory, 'eyes.json');
  await writeEyesArchive(path, await gatherEyesArchive(directory));
  return path;
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'variance-mcp-eyes-'));
}

describe('an Eyes archive a run produced', () => {
  it('is what the attention tool answers from', async () => {
    const directory = await scratch();
    try {
      const log = createEyesLog();
      recorded(log);
      const archive = await readEyesArchive(await produced(directory, log));

      const tool = eyesToolByName('variance_test_attention');
      expect(tool).toBeDefined();
      expect(tool!.run(archive, {})).toContain(
        'complete — redraws the canvas — test/drawing.test.tsx [redraw-test]',
      );

      const text = tool!.run(archive, { test: 'redraw-test' });
      expect(text).toContain('Attention journal: complete.');
      expect(text).toContain('#0 [unphased] React commit tap refused (no-hook)');
      expect(text).toContain('#2 [arrange] getByRole');
      expect(text).toContain('#4 [act] document click (synthetic)');
      expect(text).toContain('DrawingPanel at src/drawing/RedrawButton.tsx:17');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reaches the reader through the same validation an agent would fail on', async () => {
    const directory = await scratch();
    try {
      const log = createEyesLog();
      recorded(log);
      const path = await produced(directory, log);

      // The file, re-parsed from its own bytes. `readEyesArchive` is
      // `parseEyesArchive` over `JSON.parse`, and doing it the long way here is
      // what makes this an assertion about the JSON rather than about the call.
      const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
      const parsed: EyesArchive = parseEyesArchive(raw);
      expect(parsed.eyesVersion).toBe(1);
      expect(parsed.tests.map((test) => test.id)).toEqual(['redraw-test']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('tells an agent the journal is partial instead of a shorter list', async () => {
    const directory = await scratch();
    try {
      const log = createEyesLog();
      recorded(log);
      // A reporter that flushed mid-test. What is left is well-formed and starts
      // at #5, and only the archive can say the opening is missing.
      log.drain();
      log.phase('assert');

      const archive = await readEyesArchive(await produced(directory, log));
      const text = eyesToolByName('variance_test_attention')!.run(archive, { test: 'redraw-test' });

      expect(text).toContain('Attention journal: partial —');
      expect(text).toContain('#5 [assert] phase → assert');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('is served over the protocol from the path it was written to', async () => {
    const directory = await scratch();
    try {
      const log = createEyesLog();
      recorded(log);
      const path = await produced(directory, log);

      const input = new PassThrough();
      const output = new PassThrough();
      const lines = readLines(output);
      const stop = await serveEyesArchive(path, { input, output });

      try {
        input.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
        );
        expect(await lines()).toContain('variance_test_attention');

        input.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'variance_test_attention', arguments: { test: 'redraw-test' } },
          })}\n`,
        );
        const answer = await lines();
        expect(answer).toContain('redraws the canvas');
        expect(answer).toContain('RedrawButton.tsx:17');
      } finally {
        stop();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses at startup when the path is not an archive', async () => {
    await expect(serveEyesArchive(join(tmpdir(), 'variance-mcp-eyes-absent.json'))).rejects.toThrow();
  });
});

/** One response line at a time, attached before the first request. */
function readLines(output: PassThrough): () => Promise<string> {
  const held: string[] = [];
  let waiting: ((line: string) => void) | undefined;

  let buffer = '';
  output.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (waiting !== undefined) {
        const resolve = waiting;
        waiting = undefined;
        resolve(line);
      } else {
        held.push(line);
      }
    }
  });

  return () => {
    const line = held.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise<string>((resolve) => {
      waiting = resolve;
    });
  };
}
