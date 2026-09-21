import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { serve } from './server.js';
import { toolByName, type Served, type Tool } from './tools.js';

/**
 * A host answering over more than one subject reads only the half a question
 * needs, and keeps only the half a comparison looks at. Both are decisions the
 * server hands to its host: which tool was asked, and what is worth retaining.
 */
interface State {
  value: string;
  /** The expensive half — present only when something asked for it. */
  extra?: string;
}

const served: Served<State> = {
  name: 'state',
  version: '1',
  tools: [toolByName('variance_diff') as Tool<State>],
};

describe('what the server tells its host', () => {
  it('names the tool a request calls before asking for a subject', async () => {
    const asked: (string | undefined)[] = [];
    const harness = start(() => ({ value: 'one' }), asked);
    try {
      await harness.call();
      await harness.list();
      // A listing names no tool, so a host reading a subject per question is
      // told to read the cheap half rather than guess at the expensive one.
      expect(asked).toEqual(['variance_diff', undefined]);
    } finally {
      harness.stop();
    }
  });

  it('keeps what the host says to keep, rather than the whole subject', async () => {
    const harness = start((asked) => ({
      value: 'before',
      ...(asked === undefined ? {} : { extra: 'read' }),
    }));
    try {
      await harness.call();
      // `extra` arrives as an addition on the second call: it was read both
      // times, and retained neither, which is what `remember` was asked for.
      expect(await harness.call()).toContain('+ $.extra: "read"');
    } finally {
      harness.stop();
    }
  });
});

function start(
  subject: (asked?: string) => State,
  asked: (string | undefined)[] = [],
): {
  readonly call: () => Promise<string>;
  readonly list: () => Promise<void>;
  readonly stop: () => void;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = readLines(output);
  let id = 0;
  const stop = serve({
    input,
    output,
    served,
    subject: (name) => {
      asked.push(name);
      return subject(name);
    },
    remember: (state) => ({ value: state.value }),
  });

  const send = async (method: string, params?: Record<string, unknown>): Promise<string> => {
    id += 1;
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return lines();
  };

  return {
    call: async () => {
      const response = JSON.parse(await send('tools/call', { name: 'variance_diff' })) as {
        readonly result: { readonly content: readonly { readonly text: string }[] };
      };
      return response.result.content[0]!.text;
    },
    list: async () => {
      await send('tools/list');
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
