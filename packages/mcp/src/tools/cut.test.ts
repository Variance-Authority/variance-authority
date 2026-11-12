import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cutFor } from './cut.js';

const PROBES = 'sense:instrument/presence-v6';
const OTHER_TEXT = `${'0'.repeat(32)}`;

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function checkout(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'variance-cut-'));
  await writeFile(join(root, 'cart.js'), 'export function add(a, b) {\n  return a + b;\n}\n', 'utf8');
  return root;
}

const asks = (asked: ReadonlyMap<string, readonly string[]>) => ({ cuts: () => asked });

describe('the modules a host cuts for a tool', () => {
  it('reads nothing for a tool that names no region, or a host that names no checkout', async () => {
    expect(await cutFor({}, undefined, {}, await checkout())).toBeUndefined();
    expect(await cutFor(undefined, undefined, {}, root)).toBeUndefined();
    expect(await cutFor(asks(new Map([[PROBES, ['cart.js@abc']]])), undefined, {}, undefined)).toBeUndefined();
  });

  it('is empty when the call names no module', async () => {
    expect(await cutFor(asks(new Map()), undefined, {}, await checkout())).toEqual(new Map());
  });

  it('holds a file whose text moved on as not instrumented, and leaves a file that is gone out', async () => {
    const changed = `cart.js@${OTHER_TEXT}`;
    const gone = `gone.js@${OTHER_TEXT}`;

    const cut = await cutFor(asks(new Map([[PROBES, [changed, gone]]])), undefined, {}, await checkout());

    expect(cut?.get(PROBES)?.get(changed)).toMatchObject({ instrumented: false, blocks: [] });
    expect(cut?.get(PROBES)?.has(gone)).toBe(false);
  });

  it('leaves out regions numbered by probes this build does not emit', async () => {
    const cut = await cutFor(asks(new Map([['sense:instrument/nothing', ['cart.js@abc']]])), undefined, {}, await checkout());

    expect(cut).toEqual(new Map());
  });
});
