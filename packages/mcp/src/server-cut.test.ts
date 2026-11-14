import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { serve } from './server.js';
import type { Served, Tool } from './tools.js';

// The claim under test is that a checkout the host cannot read costs one call
// its answer, and not the connection every later call arrives on.

const PROBES = 'sense:instrument/presence-v6';

const names: Tool<null> = {
  name: 'names',
  description: 'Names the regions of one module.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  cuts: () => new Map([[PROBES, [`cart.js@${'0'.repeat(32)}`]]]),
  run: () => 'named',
};

const served: Served<null> = { name: 'state', version: '1', tools: [names] };

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('a call whose modules the host cannot read', () => {
  it('is answered with a tool error, and the call after it is answered too', async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-server-cut-'));
    // The path the build read a file from is a directory now.
    await mkdir(join(root, 'cart.js'));
    const input = new PassThrough();
    const output = new PassThrough();
    const answers: { id: number; result?: { isError?: boolean } }[] = [];
    let buffered = '';
    output.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) if (line !== '') answers.push(JSON.parse(line) as (typeof answers)[number]);
    });
    const stop = serve({ input, output, served, subject: () => null, root });

    try {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'names' } })}\n`);
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
      await expect.poll(() => answers.map((answer) => answer.id)).toEqual([1, 2]);

      expect(answers[0]!.result?.isError).toBe(true);
    } finally {
      stop();
    }
  });
});
