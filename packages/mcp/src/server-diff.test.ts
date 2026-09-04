import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { serve } from './server.js';
import { toolByName, type Served, type Tool } from './tools.js';

interface State {
  value: string;
}

const served: Served<State> = {
  name: 'state',
  version: '1',
  tools: [toolByName('variance_diff') as Tool<State>],
};

describe('the state held by the server', () => {
  it('diffs against exactly the previous successful invocation', async () => {
    const harness = start({ value: 'before' });
    try {
      expect(await harness.call()).toContain('No previous invocation was recorded');

      harness.replace({ value: 'after' });
      expect(await harness.call()).toContain('~ $.value: "before" -> "after"');
      expect(await harness.call()).toContain('matches the previous invocation');
    } finally {
      harness.stop();
    }
  });

  it('records state by value rather than retaining a mutable subject', async () => {
    const current = { value: 'before' };
    const harness = start(current);
    try {
      await harness.call();
      current.value = 'after';
      expect(await harness.call()).toContain('~ $.value: "before" -> "after"');
    } finally {
      harness.stop();
    }
  });
});

function start(initial: State): {
  readonly call: () => Promise<string>;
  readonly replace: (next: State) => void;
  readonly stop: () => void;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = readLines(output);
  let current = initial;
  let id = 0;
  const stop = serve({ input, output, served, subject: () => current });

  return {
    call: async () => {
      id += 1;
      input.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'variance_diff' } })}\n`,
      );
      const response = JSON.parse(await lines()) as {
        readonly result: { readonly content: readonly { readonly text: string }[] };
      };
      return response.result.content[0]!.text;
    },
    replace: (next) => {
      current = next;
    },
    stop,
  };
}

function readLines(output: PassThrough): () => Promise<string> {
  const held: string[] = [];
  let waiting: ((line: string) => void) | undefined;
  let buffer = '';

  output.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (waiting === undefined) held.push(line);
      else {
        const resolve = waiting;
        waiting = undefined;
        resolve(line);
      }
    }
  });

  return () => {
    const line = held.shift();
    return line === undefined
      ? new Promise<string>((resolve) => {
          waiting = resolve;
        })
      : Promise.resolve(line);
  };
}
