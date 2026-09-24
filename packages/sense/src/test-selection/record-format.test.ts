import { digestString } from '@variance-authority/core/format';
import { describe, expect, it } from 'vitest';
import type { CoverageBlock } from './index.js';
import type { CapturedModule } from './instrumented-modules.js';
import {
  UNNUMBERED,
  decodeRecord,
  frameRecord,
  framePath,
  frames,
  readSegmentHeader,
  segmentHeader,
} from './record-format.js';

/** A module root owns nobody, which is the one block with no `owner` at all. */
const BLOCKS: readonly CoverageBlock[] = [
  {
    ordinal: 0,
    kind: 'module',
    digest: digestString('whole'),
    name: '',
    path: 'module',
    startLine: 1,
    endLine: 10,
    source: true,
    testFiles: [],
  },
  {
    ordinal: 1,
    kind: 'function',
    owner: 0,
    digest: digestString('body'),
    name: 'total',
    path: 'entry',
    startLine: 3,
    endLine: 8,
    source: true,
    testFiles: [],
  },
  {
    ordinal: 2,
    kind: 'branch',
    owner: 1,
    digest: digestString('alternative'),
    name: '',
    path: 'entry/if',
    startLine: 4,
    endLine: 4,
    source: false,
    testFiles: [],
  },
];

const captured = (over: Partial<CapturedModule> = {}): CapturedModule => {
  const file = over.file ?? 'src/cart.js';
  return {
    file,
    id: file,
    sourceDigest: digestString('const total = () => 1;'),
    instrumented: true,
    blocks: BLOCKS,
    ...over,
  };
};

const segment = (...modules: readonly CapturedModule[]): Buffer =>
  Buffer.concat([segmentHeader('recipe'), ...modules.map(frameRecord)]);

const readAll = (raw: Buffer): Array<CapturedModule | undefined> => {
  const header = readSegmentHeader(raw)!;
  return [...frames(raw, header.frames)].map((frame) => decodeRecord(raw, frame));
};

describe('a module record as bytes', () => {
  it('round-trips every field a coverage row is built from', () => {
    const module = captured();

    expect(readAll(segment(module))).toEqual([module]);
  });

  it('costs a fraction of the same record as JSON', () => {
    const module = captured();

    expect(frameRecord(module).byteLength).toBeLessThan(
      Buffer.byteLength(JSON.stringify(module)) / 2,
    );
  });

  it('keeps a module the parser refused, with no blocks and no claim', () => {
    const refused = captured({ instrumented: false, blocks: [] });

    expect(readAll(segment(refused))).toEqual([refused]);
  });

  it('names the recipe the segment was cut by, and nothing that is not a segment', () => {
    expect(readSegmentHeader(segmentHeader('sense:instrument/presence-v5'))).toMatchObject({
      instrumentation: 'sense:instrument/presence-v5',
    });
    expect(readSegmentHeader(Buffer.from('{"modules":[]}', 'utf8'))).toBeUndefined();
    expect(readSegmentHeader(Buffer.alloc(0))).toBeUndefined();
  });

  it('files a numbered frame under its number, and a scan reads it without decoding', () => {
    const raw = segment(captured({ id: 41 }));
    const [frame] = [...frames(raw, readSegmentHeader(raw)!.frames)];

    expect(frame!.id).toBe(41);
    expect(framePath(raw, frame!)).toBe('src/cart.js');
  });

  it('files a module the table has no number for under the path it carries', () => {
    const raw = segment(captured());
    const [frame] = [...frames(raw, readSegmentHeader(raw)!.frames)];

    expect(frame!.id).toBe(UNNUMBERED);
    expect(framePath(raw, frame!)).toBe('src/cart.js');
    expect(readAll(raw)[0]?.id).toBe('src/cart.js');
  });

  it('loses the tail of a write that was interrupted, and nothing before it', () => {
    const whole = segment(captured({ file: 'src/a.js' }), captured({ file: 'src/b.js' }));
    const torn = whole.subarray(0, whole.length - 40);

    expect(readAll(torn).map((module) => module?.file)).toEqual(['src/a.js']);
  });

  it('refuses a frame a byte of which was lost silently', () => {
    const raw = segment(captured());
    const [frame] = [...frames(raw, readSegmentHeader(raw)!.frames)];
    raw[frame!.at + Math.floor(frame!.length / 2)] ^= 0xff;

    expect(readAll(raw)).toEqual([undefined]);
  });

  it('keeps the order two appends of one module were written in', () => {
    const first = captured({ sourceDigest: digestString('one') });
    const second = captured({ sourceDigest: digestString('two') });

    expect(readAll(segment(first, second)).map((module) => module?.sourceDigest)).toEqual([
      first.sourceDigest,
      second.sourceDigest,
    ]);
  });
});
