import { describe, expect, it } from 'vitest';
import type { FileSet, Tool, ToolInvocation } from '@variance-authority/mcp/tools';
import { FoundNothing } from './find.js';
import { intersectionOf } from './intersection.js';

/**
 * An intersection runs whole questions and answers the files every one of them
 * answers. The operands here are stand-ins that answer a fixed set, so what is
 * tested is the operation over sets — which question said what, which files
 * survive, what was not read — and not any one question's reading.
 */

interface Asked {
  readonly subject: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly invocation: ToolInvocation<string> | undefined;
}

function operand(verb: string, answer: (input: Readonly<Record<string, unknown>>) => FileSet, asked: Asked[] = []): Tool<string> {
  return {
    name: `docs_${verb.replace(/-/g, '_')}`,
    description: verb,
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, from: { type: 'string' }, imports: { type: 'array' } } },
    wants: (input) => input['from'] !== undefined,
    run: () => `${verb} answered`,
    files: (subject, input, invocation) => {
      asked.push({ subject, input, invocation });
      return answer(input);
    },
  };
}

const set = (files: Record<string, readonly number[]>, unread?: readonly string[]): FileSet => ({
  files: new Map(Object.entries(files)),
  ...(unread === undefined ? {} : { unread }),
});

const declares = operand('symbol', () => set({ 'src/store/selectors.ts': [1], 'src/old/selectors.ts': [1] }));
const reaches = operand('discover', () => set({ 'src/Wallet.ts': [], 'src/store/index.ts': [], 'src/store/selectors.ts': [] }));
const publishing = operand('packages', () => set({}));
const lines = operand('grep', () => set({ 'src/store/selectors.ts': [4, 9], 'src/Wallet.ts': [2] }, ['ripgrep: src/big.bin: binary']));
const refusing = operand('uses', () => {
  throw new Error('`selectBalanse` is not a name this workspace declares; did you mean `selectBalance`?');
});
const elsewhere = operand('search', () => set({ 'src/Nav.ts': [] }));
delete (publishing as { files?: unknown }).files;

const intersection = intersectionOf<string>([declares, reaches, publishing, lines, refusing, elsewhere]);
const ask = (questions: readonly unknown[], extra: Readonly<Record<string, unknown>> = {}): string =>
  intersection.run('workspace', { questions, ...extra }, { root: '/checkout' });

describe('an intersection answers the files every question answers', () => {
  it('keeps the file both questions answer and drops the one only the first does', () => {
    const text = ask([
      { question: 'symbol', input: { name: 'selectBalance' } },
      { question: 'discover', input: { from: 'src/Wallet.ts' } },
    ]);
    expect(text).toContain('1. `{"question":"symbol","input":{"name":"selectBalance"}}`: 2 files');
    expect(text).toContain('2. `{"question":"discover","input":{"from":"src/Wallet.ts"}}`: 3 files');
    expect(text).toContain('1 file in all of them.');
    expect(text).toContain('src/store/selectors.ts — 1: line 1 · 2: the file');
    expect(text).not.toContain('src/old/selectors.ts');
    expect(text).not.toContain('src/Wallet.ts —');
  });

  it('names each question as the surface it was asked on takes it back', () => {
    const questions = [
      { question: 'symbol', input: { name: 'selectBalance' } },
      { question: 'discover', input: { from: 'src/Wallet.ts' } },
    ];
    const shell = intersection.run('workspace', { questions }, { root: '/checkout', shell: 'variance ask' });
    expect(shell).toContain('1. `symbol --name selectBalance`: 2 files');
    expect(shell).toContain('2. `discover --from src/Wallet.ts`: 3 files');
    const wire = ask(questions);
    expect(wire).toContain('1. `{"question":"symbol","input":{"name":"selectBalance"}}`: 2 files');
    expect(wire).not.toContain('--name');
  });

  it('crosses three questions, listing the common files in code-unit order with every line that put each there', () => {
    const text = ask([
      { question: 'discover', input: { from: 'src/Wallet.ts' } },
      { question: 'grep', input: { from: 'src/Wallet.ts' } },
      { question: 'discover', input: { from: 'src/Wallet.ts' } },
    ]);
    expect(text).toContain('2 files in all of them.');
    const [first, second] = ['src/Wallet.ts —', 'src/store/selectors.ts —'].map((line) => text.indexOf(line));
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first!);
    expect(text).toContain('src/store/selectors.ts — 1: the file · 2: lines 4, 9 · 3: the file');
  });

  it('says what a question could not read, beside that question', () => {
    const text = ask([
      { question: 'grep', input: { from: 'src/Wallet.ts' } },
      { question: 'symbol', input: { name: 'selectBalance' } },
    ]);
    expect(text).toContain('1. `{"question":"grep","input":{"from":"src/Wallet.ts"}}`: 2 files — ripgrep: src/big.bin: binary');
  });

  it('says no file is in all of them rather than printing an empty list', () => {
    const text = ask([
      { question: 'symbol', input: { name: 'selectBalance' } },
      { question: 'grep', input: { from: 'src/Wallet.ts' } },
      { question: 'discover', input: { from: 'src/Wallet.ts' } },
    ]);
    expect(text).toContain('1 file in all of them.');
    const none = ask([
      { question: 'symbol', input: { name: 'selectBalance' } },
      { question: 'search', input: { name: 'nav' } },
    ]);
    expect(none).toContain('No file is in all of them.');
  });

  it('counts the common files a limit leaves out', () => {
    const text = ask(
      [
        { question: 'discover', input: { from: 'src/Wallet.ts' } },
        { question: 'discover', input: { from: 'src/Wallet.ts' } },
      ],
      { limit: 1 },
    );
    expect(text).toContain('3 files in all of them.');
    expect(text).toContain('src/Wallet.ts — 1: the file · 2: the file');
    expect(text).not.toContain('src/store/index.ts —');
    expect(text).toContain('2 more not shown; a higher `limit` shows them.');
  });

  it('asks each question with the subject and everything the host read', () => {
    const asked: Asked[] = [];
    const watched = intersectionOf<string>([operand('symbol', () => set({ 'a.ts': [1] }), asked)]);
    const tree = { root: '/checkout' } as unknown as NonNullable<ToolInvocation<string>['tree']>;
    watched.run('workspace', { questions: [{ question: 'symbol', input: { name: 'a' } }, { question: 'symbol', input: { name: 'b' } }] }, { tree, root: '/checkout' });
    expect(asked.map((one) => [one.subject, one.input['name'], one.invocation?.tree, one.invocation?.root])).toEqual([
      ['workspace', 'a', tree, '/checkout'],
      ['workspace', 'b', tree, '/checkout'],
    ]);
  });

  it('wants the tree when any of its questions does', () => {
    expect(intersection.wants?.({ questions: [{ question: 'symbol', input: { name: 'a' } }, { question: 'discover', input: { from: 'a.ts' } }] })).toBe(true);
    expect(intersection.wants?.({ questions: [{ question: 'symbol', input: { name: 'a' } }, { question: 'symbol', input: { name: 'b' } }] })).toBe(false);
  });
});

describe('an intersection over a name nothing declares', () => {
  const asked: Asked[] = [];
  const nowhere = (input: Readonly<Record<string, unknown>>): never => {
    throw new FoundNothing(`No file declares \`${String(input['name'])}\`.`);
  };
  const crossing = intersectionOf<string>([
    operand('symbol', (input) => (input['name'] === 'selectBalance' ? set({ 'src/store/selectors.ts': [1] }) : nowhere(input)), asked),
    operand('uses', nowhere, asked),
  ]);
  const cross = (questions: readonly unknown[]): unknown => {
    try {
      return crossing.run('workspace', { questions }, { root: '/checkout' });
    } catch (thrown) {
      return thrown;
    }
  };

  it('answers that no file is in all of them, naming the question that found nothing beside it', () => {
    asked.length = 0;
    const answer = cross([
      { question: 'symbol', input: { name: 'selectBalance' } },
      { question: 'uses', input: { name: 'gone' } },
    ]);
    // Found nothing, so a host reading a reused generation asks it again before it believes it.
    expect(answer).toBeInstanceOf(FoundNothing);
    expect((answer as FoundNothing).message).toBe(
      [
        '1. `{"question":"symbol","input":{"name":"selectBalance"}}`: 1 file',
        '2. `{"question":"uses","input":{"name":"gone"}}`: 0 files — No file declares `gone`.',
        '',
        'No file is in all of them.',
      ].join('\n'),
    );
    expect(asked.map((one) => one.input['name'])).toEqual(['selectBalance', 'gone']);
  });

  it('names every question that found nothing, not only the first', () => {
    const answer = cross([
      { question: 'symbol', input: { name: 'lost' } },
      { question: 'uses', input: { name: 'gone' } },
    ]);
    expect(answer).toBeInstanceOf(FoundNothing);
    expect((answer as FoundNothing).message).toContain('1. `{"question":"symbol","input":{"name":"lost"}}`: 0 files — No file declares `lost`.');
    expect((answer as FoundNothing).message).toContain('2. `{"question":"uses","input":{"name":"gone"}}`: 0 files — No file declares `gone`.');
  });
});

describe('an intersection refuses what is not an operation over sets', () => {
  it('refuses fewer than two questions', () => {
    expect(() => ask([{ question: 'symbol', input: { name: 'selectBalance' } }])).toThrow(/two or more questions/);
  });

  it('refuses a question whose answer is not a set of files, naming the ones that are', () => {
    expect(() =>
      ask([
        { question: 'packages', input: {} },
        { question: 'symbol', input: { name: 'selectBalance' } },
      ]),
    ).toThrow(/`packages` answers no set of files; the questions that do: symbol, discover, grep, uses, search/);
  });

  it('refuses a question it does not know, naming the ones it does', () => {
    expect(() =>
      ask([
        { question: 'symbols', input: {} },
        { question: 'symbol', input: { name: 'selectBalance' } },
      ]),
    ).toThrow(/`symbols` is not a question; the questions that answer a set of files: symbol, discover, grep, uses, search/);
  });

  it('says which question refused, and passes its refusal on whole', () => {
    expect(() =>
      ask([
        { question: 'symbol', input: { name: 'selectBalance' } },
        { question: 'uses', input: { name: 'selectBalanse' } },
      ]),
    ).toThrow('question 2, `{"question":"uses","input":{"name":"selectBalanse"}}`: `selectBalanse` is not a name this workspace declares; did you mean `selectBalance`?');
  });

  it('refuses a question that is not a question and its input', () => {
    expect(() => ask(['symbol --name selectBalance', { question: 'symbol', input: { name: 'a' } }])).toThrow(
      /each question is an object with `question` and `input`/,
    );
  });
});
