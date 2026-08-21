import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCapture } from './archive.js';
import { snapshotValue } from './value.js';

/**
 * The value subject, from the unit process to the file a later run reads.
 *
 * Two questions, and the second is the one this file exists for. What lands on
 * disk — a capture the shared reader accepts, carrying the shaping the caller
 * asked for. And what the reader refuses: a file whose text no longer matches
 * the digest it claims, which is the only failure a content-addressed baseline
 * can have and the only one nothing else would notice.
 */

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'variance-value-'));
  temporary.push(made);
  return made;
}

describe('snapshotValue', () => {
  it('writes a capture the shared reader accepts', async () => {
    const path = await snapshotValue(
      { ok: true, items: [] },
      { subject: 'api/health', directory: await directory() },
    );

    const artifact = await readCapture(path);
    expect(artifact.subject).toEqual({ id: 'api/health', kind: 'value' });
    expect(artifact.material.kind).toBe('value');
  });

  it('makes a bare string a value subject, not a fixture', async () => {
    // `capture` reads a bare string as `fixture` because what it took was a
    // mounted DOM. Nothing here was mounted, and the kind is what the report
    // will say this subject is.
    const path = await snapshotValue(1, { subject: 'counter', directory: await directory() });

    expect((await readCapture(path)).subject.kind).toBe('value');
  });

  it('carries a subject given in full', async () => {
    const path = await snapshotValue([], {
      subject: { id: 'routes', kind: 'value', title: 'The route table' },
      directory: await directory(),
    });

    expect((await readCapture(path)).subject).toEqual({
      id: 'routes',
      kind: 'value',
      title: 'The route table',
    });
  });

  it('writes canonical text, not the object', async () => {
    // Key order is the caller's and must not be the record's: two processes
    // building the same response in a different order would otherwise disagree.
    const path = await snapshotValue(
      { b: 2, a: 1 },
      { subject: 'api/two', directory: await directory() },
    );

    const artifact = await readCapture(path);
    expect(artifact.material.kind === 'value' && artifact.material.value.text).toBe('{"a":1,"b":2}');
  });

  it('carries the shaping the caller asked for', async () => {
    const path = await snapshotValue(
      { at: '2026-08-21T09:00:00Z', rows: [{ id: 'b' }, { id: 'a' }] },
      {
        subject: 'api/rows',
        directory: await directory(),
        dialect: 'openapi',
        drop: ['/at'],
        arrayKey: { '/rows': 'id' },
        generator: { name: 'oasgen', version: '3.1.0' },
      },
    );

    const artifact = await readCapture(path);
    if (artifact.material.kind !== 'value') throw new Error('not a value capture');
    expect(artifact.material.value.dialect).toBe('openapi');
    expect(artifact.material.value.keyed).toEqual(['/rows']);
    expect(artifact.material.value.generator).toEqual({ name: 'oasgen', version: '3.1.0' });
    expect(artifact.material.value.text).toBe('{"at":"[dropped]","rows":{"a":{"id":"a"},"b":{"id":"b"}}}');
  });

  it('refuses a value that cannot be one, and says where', async () => {
    await expect(
      snapshotValue({ handlers: [() => undefined] }, {
        subject: 'api/handlers',
        directory: await directory(),
      }),
    ).rejects.toThrow('/handlers/0');
  });

  it('refuses the second capture for one subject id', async () => {
    const into = await directory();
    await snapshotValue(1, { subject: 'api/health', directory: into });

    await expect(snapshotValue(2, { subject: 'api/health', directory: into })).rejects.toThrow(
      'already has a capture',
    );
  });
});

describe('reading one back', () => {
  it('refuses text that no longer matches its digest', async () => {
    // The failure a content-addressed baseline can actually have: somebody
    // edits the file to make a run pass, and every later run compares against
    // an edit nobody captured. The digest is recomputed here rather than
    // believed, exactly as a resource's bytes are.
    const path = await snapshotValue(
      { ok: true },
      { subject: 'api/health', directory: await directory() },
    );
    const artifact = JSON.parse(await readFile(path, 'utf8')) as {
      material: { value: { text: string } };
    };
    artifact.material.value.text = '{"ok":false}';
    await writeFile(path, JSON.stringify(artifact), 'utf8');

    await expect(readCapture(path)).rejects.toThrow('does not match its digest');
  });

  it('refuses a value capture that is missing its dialect', async () => {
    const path = await snapshotValue(1, { subject: 'counter', directory: await directory() });
    const artifact = JSON.parse(await readFile(path, 'utf8')) as {
      material: { value: Record<string, unknown> };
    };
    delete artifact.material.value['dialect'];
    await writeFile(path, JSON.stringify(artifact), 'utf8');

    await expect(readCapture(path)).rejects.toThrow('does not contain a captured value');
  });
});
