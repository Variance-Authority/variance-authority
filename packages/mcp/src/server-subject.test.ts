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

  it('hands the host the arguments a call names, so a host that fetches reads only that window', async () => {
    const given: (Readonly<Record<string, unknown>> | undefined)[] = [];
    const harness = start(() => ({ value: 'one' }), [], given);
    try {
      await harness.call({ since: 'a' });
      await harness.list();
      expect(given).toEqual([{ since: 'a' }, undefined]);
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

describe('a refused call', () => {
  /** A tool that knows a name only once the subject has been read again. */
  const named: Served<State> = {
    name: 'state',
    version: '1',
    tools: [{
      name: 'named',
      description: 'answers only from a fresh subject',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: (state, input) => {
        if (typeof input['name'] !== 'string') throw new Error('`name` is required');
        if (state.value !== 'fresh') throw new Error(`not in ${state.value}`);
        return 'found';
      },
    }],
  };

  type Again = (asked: string | undefined, refused: State, started: number) => Promise<{ subject?: State; footer?: string } | undefined>;

  type Answered = NonNullable<Parameters<typeof serve<State>>[0]['answered']>;

  async function asked(again?: Again, params: Readonly<Record<string, unknown>> = { name: 'named', arguments: { name: 'kept' } }, answered?: Answered) {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = readLines(output);
    const stop = serve({
      input,
      output,
      served: named,
      subject: () => ({ value: 'reused' }),
      ...(again === undefined ? {} : { again }),
      ...(answered === undefined ? {} : { answered }),
    });
    try {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params })}\n`);
      const response = JSON.parse(await lines()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { message: string } };
      return response.result ?? { content: [{ text: response.error!.message }], isError: true };
    } finally {
      stop();
    }
  }

  it('is asked again of the subject the host reads after it, with the refused one and when it started', async () => {
    const handed: [string | undefined, string, number][] = [];
    const before = Date.now();
    const result = await asked(async (tool, refused, started) => {
      handed.push([tool, refused.value, started]);
      return { subject: { value: 'fresh' } };
    });
    expect(result.content[0]!.text).toBe('found');
    expect(handed).toHaveLength(1);
    expect(handed[0]!.slice(0, 2)).toEqual(['named', 'reused']);
    expect(handed[0]![2]).toBeGreaterThanOrEqual(before);
  });

  it('stands when the host reads nothing newer', async () => {
    const result = await asked(async () => undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not in reused');
  });

  it('carries what the host says about a subject it could not read again', async () => {
    const result = await asked(async () => ({ footer: 'not compared: the reading failed' }));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('not in reused\n\nnot compared: the reading failed');
  });

  it('is an answer when the host reads what the tool threw as one, once it was asked again', async () => {
    const handed: [unknown, string, unknown][] = [];
    const result = await asked(
      async () => ({ subject: { value: 'still' }, footer: 'the lexicon was not refreshed' }),
      undefined,
      (refusal, subject, again) => {
        handed.push([refusal, subject.value, again?.footer]);
        return `${(refusal as Error).message}, said as an answer`;
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('not in still, said as an answer');
    expect(handed).toHaveLength(1);
    expect(handed[0]![0]).toBeInstanceOf(Error);
    expect(handed[0]!.slice(1)).toEqual(['still', 'the lexicon was not refreshed']);
  });

  it('is an answer for a host that reads its subject fresh and passes no `again`', async () => {
    const handed: unknown[] = [];
    const result = await asked(undefined, undefined, (refusal, _subject, again) => {
      handed.push(again);
      return `${(refusal as Error).message}, said as an answer`;
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('not in reused, said as an answer');
    expect(handed).toEqual([undefined]);
  });

  it('is not handed to the host when the call names a tool the server does not have', async () => {
    const handed: unknown[] = [];
    const result = await asked(undefined, { name: 'absent', arguments: {} }, (refusal) => {
      handed.push(refusal);
      return 'said as an answer';
    });
    expect(result.isError).toBe(true);
    expect(handed).toEqual([]);
  });

  it('stands, with what the host said, when the host does not read it as an answer', async () => {
    const result = await asked(async () => ({ footer: 'not compared: the reading failed' }), undefined, () => undefined);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('not in reused\n\nnot compared: the reading failed');
  });

  it('is not asked again for a tool the server does not have, or a call missing an argument', async () => {
    const handed: (string | undefined)[] = [];
    const again: Again = async (tool) => {
      handed.push(tool);
      return { subject: { value: 'fresh' } };
    };
    expect((await asked(again, { name: 'unnamed' })).content[0]!.text).toContain('unknown tool');
    expect((await asked(again, { name: 'named' })).content[0]!.text).toContain('`name` is required');
    expect((await asked(again, { name: 'named', arguments: { name: '' } })).content[0]!.text).toContain('not in reused');
    expect(handed).toEqual([]);
  });
});

function start(
  subject: (asked?: string) => State,
  asked: (string | undefined)[] = [],
  given: (Readonly<Record<string, unknown>> | undefined)[] = [],
): {
  readonly call: (args?: Readonly<Record<string, unknown>>) => Promise<string>;
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
    subject: (name, input) => {
      asked.push(name);
      given.push(input);
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
    call: async (args) => {
      const response = JSON.parse(
        await send('tools/call', { name: 'variance_diff', ...(args === undefined ? {} : { arguments: args }) }),
      ) as {
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
