import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ComponentRecord } from './composition.js';
import type { RunReport } from './format.js';
import type { LexiconReport } from './lexicon.js';
import { readSuiteIndex, writeSuiteIndex } from './file.js';
import {
  decodeSuiteIndex,
  encodeSuiteIndex,
  suiteIndexOf,
  type SuiteIndex,
} from './suite-index.js';

const LEXICON: LexiconReport = {
  version: 1,
  fields: ['example', 'names', 'components', 'roles', 'tokens'],
  subjects: [
    {
      subject: 'checkout/summary',
      boundaries: 9,
      terms: {
        example: ['Summary'],
        names: ['Order summary', 'Total'],
        components: ['Price', 'Summary'],
        roles: [],
      },
      elided: { names: 4 },
    },
    {
      subject: 'checkout/empty',
      boundaries: 1,
      terms: { example: ['Empty'] },
    },
  ],
};

const INDEX: SuiteIndex = {
  commit: '9f1c0b3a',
  subjects: ['checkout/summary', 'checkout/empty'],
  components: [
    componentOf({
      component: 'Price',
      subjects: ['checkout/summary'],
      instances: 4,
      within: ['Summary'],
      createdBy: ['Summary'],
      renders: ['span'],
      tokens: ['--price-fg'],
      variants: 2,
      renderings: 3,
    }),
    componentOf({ component: 'Summary', subjects: ['checkout/summary'], examples: ['checkout/summary'] }),
  ],
  lexicon: LEXICON,
};

describe('a suite index as bytes', () => {
  it('round-trips every field it carries', () => {
    expect(decodeSuiteIndex(encodeSuiteIndex(INDEX))).toEqual(INDEX);
  });

  it('round-trips an index with neither a commit nor a lexicon', () => {
    const bare: SuiteIndex = { subjects: [], components: [] };
    const read = decodeSuiteIndex(encodeSuiteIndex(bare));
    expect(read).toEqual(bare);
    expect('commit' in read).toBe(false);
    expect('lexicon' in read).toBe(false);
  });

  it('keeps a field that was read and found empty apart from one that was not read', () => {
    const read = decodeSuiteIndex(encodeSuiteIndex(INDEX));
    const subject = read.lexicon?.subjects[0];
    expect(subject?.terms.roles).toEqual([]);
    expect(subject?.terms.text).toBeUndefined();
    expect(read.lexicon?.fields).not.toContain('text');
  });

  it('writes the same bytes for the same facts', () => {
    const again: SuiteIndex = {
      ...INDEX,
      components: [...INDEX.components].reverse().reverse(),
      lexicon: { version: 1, fields: [...LEXICON.fields], subjects: [...LEXICON.subjects] },
    };
    expect(Buffer.from(encodeSuiteIndex(again))).toEqual(Buffer.from(encodeSuiteIndex(INDEX)));
  });

  it('refuses a subject speaking a vocabulary the run did not read', () => {
    expect(() => encodeSuiteIndex({
      ...INDEX,
      lexicon: {
        version: 1,
        fields: ['example'],
        subjects: [{ subject: 'checkout/summary', boundaries: 1, terms: { files: ['a.tsx'] } }],
      },
    })).toThrow(/did not read/);
  });

  it('refuses bytes that are not a suite index', () => {
    expect(() => decodeSuiteIndex(new Uint8Array(0))).toThrow(/not a variance-authority suite index/);
    expect(() => decodeSuiteIndex(new TextEncoder().encode('{"format":"x"}')))
      .toThrow(/not a variance-authority suite index/);
  });

  it('refuses a truncated segment rather than reading half of one', () => {
    const encoded = encodeSuiteIndex(INDEX);
    expect(() => decodeSuiteIndex(encoded.subarray(0, encoded.length - 8)))
      .toThrow(/not a variance-authority suite index/);
  });

  it('refuses a segment whose header claims another format', () => {
    const encoded = encodeSuiteIndex(INDEX);
    const length = new DataView(encoded.buffer, encoded.byteOffset).getUint32(0, true);
    const header = new TextDecoder().decode(encoded.subarray(4, 4 + length)).replace(/\0+$/, '');
    const foreign = JSON.parse(header) as { format: string; version: number };
    expect(foreign.format).toBe('variance-authority-suite-index');
    expect(foreign.version).toBe(1);
    const bytes = Uint8Array.from(encoded);
    bytes.set(new TextEncoder().encode('variance-authority-source'), 4 + header.indexOf(foreign.format));
    expect(() => decodeSuiteIndex(bytes)).toThrow(/not a variance-authority suite index/);
  });
});

describe('a suite index taken from a run report', () => {
  it('carries the composition, the subjects, the commit and the lexicon', () => {
    const index = suiteIndexOf(reportOf({
      run: { id: 'run-1', commit: '9f1c0b3a' },
      composition: { subjects: INDEX.subjects, components: INDEX.components },
      lexicon: LEXICON,
    }));
    expect(index).toEqual(INDEX);
  });

  it('is nothing at all when the run read no composition', () => {
    expect(suiteIndexOf(reportOf({}))).toBeUndefined();
  });

  it('is an index with no commit when the run could not name itself', () => {
    const index = suiteIndexOf(reportOf({
      composition: { subjects: [], components: [] },
    }));
    expect(index).toBeDefined();
    expect(index && 'commit' in index).toBe(false);
  });
});

describe('a suite index on a disk', () => {
  it('reads back what it wrote, through a directory that did not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-suite-index-'));
    const path = join(directory, 'baseline', '9f1c0b3a.vasi');
    await writeSuiteIndex(path, INDEX);
    expect(await readSuiteIndex(path)).toEqual(INDEX);
  });

  it('refuses a file that is not one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-suite-index-'));
    const path = join(directory, 'run.json');
    await writeFile(path, '{"runVersion":1}');
    await expect(readSuiteIndex(path)).rejects.toThrow(/not a variance-authority suite index/);
  });

  it('reads a file back off a disk without losing its column alignment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-suite-index-'));
    const path = join(directory, 'index.vasi');
    await writeSuiteIndex(path, INDEX);
    const raw = await readFile(path);
    expect(decodeSuiteIndex(raw.subarray(0))).toEqual(INDEX);
  });
});

function componentOf(record: Partial<ComponentRecord> & { component: string }): ComponentRecord {
  return {
    subjects: [],
    instances: 1,
    examples: [],
    within: [],
    createdBy: [],
    renders: [],
    tokens: [],
    variants: 1,
    renderings: 1,
    ...record,
  };
}

function reportOf(report: Partial<RunReport>): RunReport {
  return { runVersion: 1, observations: [], ...report } as RunReport;
}
