import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { writeRunReport } from '@variance-authority/report/file';
import { serveReportFile } from './server.js';

/**
 * The source tree a report server reads for a question with a start point:
 * read once the question asks for it, and a walk that fails refuses the
 * question and says why on stderr.
 */

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: {
    renderer: 'playwright-chromium',
    engine: 'chromium@131.0.0',
    platform: 'darwin/arm64',
    deviceScaleFactor: 1,
    fonts: [],
  },
  retention: 'ephemeral',
  observations: [{ subject: 'story:toggle--on', verdict: 'unchanged' }],
};

/** The first line the server writes. */
function firstLine(output: PassThrough): Promise<string> {
  let buffer = '';
  return new Promise((resolve) => {
    output.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const end = buffer.indexOf('\n');
      if (end !== -1) resolve(buffer.slice(0, end));
    });
  });
}

describe('the report server\'s source tree', () => {
  /** One `variance_locate` from a start point, which is the call that asks for the tree. */
  const locateFrom = (id: number, from: string) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'variance_locate', arguments: { query: 'toggle', from } },
  });

  async function answerFrom(root: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'va-mcp-'));
    try {
      const path = join(directory, 'run.json');
      await writeRunReport(path, REPORT);
      const input = new PassThrough();
      const output = new PassThrough();
            const stop = await serveReportFile(path, { input, output, root });
      try {
        input.write(`${JSON.stringify(locateFrom(1, 'src/ds/components.tsx'))}\n`);
        return await firstLine(output);
      } finally {
        stop();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('reads the tree under the root before answering a question with a start point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'va-mcp-tree-'));
    try {
      await mkdir(join(root, 'src/ds'), { recursive: true });
      await writeFile(join(root, 'src/ds/components.tsx'), 'export const Toggle = () => null;\n');
      const answer = await answerFrom(root);
      expect(answer).not.toContain('no source tree was read');
      expect(answer).not.toContain('is not found');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses the question and tells the operator on stderr where the tree could not be read', async () => {
    const said: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      said.push(String(chunk));
      return true;
    });
    try {
      const directory = await mkdtemp(join(tmpdir(), 'va-mcp-tree-'));
      // A root that is a file: the walk cannot list it.
      const root = join(directory, 'a-file');
      await writeFile(root, '');
      const answer = await answerFrom(root).finally(() => rm(directory, { recursive: true, force: true }));
      expect(answer).toContain('no source tree was read');
      expect(said.join('')).toContain('could not be read');
    } finally {
      write.mockRestore();
    }
  });
});
