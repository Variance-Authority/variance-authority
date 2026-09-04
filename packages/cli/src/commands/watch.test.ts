// The claim under test is that the two processes meet: a watcher started here is
// readable from a reader that knows only the address it printed, and a reader
// that cannot reach one is told which of the two mistakes it made rather than
// being handed a dropped connection.

import { afterEach, describe, expect, it } from 'vitest';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import { readVantage, watch, watching, type Watching } from './watch.js';

const started: Watching[] = [];

async function watcher(): Promise<Watching> {
  const one = await watch();
  started.push(one);
  return one;
}

afterEach(async () => {
  for (const one of started.splice(0)) await one.close();
});

describe('what a watcher prints', () => {
  it('is the line the suite has to be started with, ready to copy', () => {
    // The reader's only handshake. Printing the address without the variable
    // would leave them to know a name this command never says.
    expect(watching('http://127.0.0.1:4100')).toContain(
      `${VANTAGE_VARIABLE}=http://127.0.0.1:4100`,
    );
  });

  it('is also the command that reads it back, on the same address', () => {
    expect(watching('http://127.0.0.1:4100')).toContain(
      'variance ask self --at http://127.0.0.1:4100',
    );
  });

  it('says the run is gone when it stops, because nothing here writes it down', () => {
    expect(watching('http://127.0.0.1:4100')).toContain('writes nothing down');
  });
});

describe('a watcher and a reader', () => {
  it('meet on the address, with nothing else arranged between them', async () => {
    const one = await watcher();

    expect((await readVantage(one.address)).state.address).toBe(one.address);
  });

  it('meet on the address however the reader spelled it', async () => {
    // Whatever a shell put in the variable. A trailing slash is not a different
    // watcher, and refusing one would be a refusal about punctuation.
    const one = await watcher();

    expect((await readVantage(`${one.address}/`)).state.address).toBe(one.address);
  });

  it('stays up until it is asked to stop, which is what makes it askable at all', async () => {
    // The medium `unref`s its listener so a finished suite is not held open. A
    // watcher is the one process for which that is wrong.
    const one = await watcher();

    expect(await Promise.race([one.until.then(() => 'stopped'), Promise.resolve('waiting')])).toBe(
      'waiting',
    );
  });
});

describe('a reader with no watcher to read', () => {
  it('is told nothing answered, and what starts one', async () => {
    // The failure that looks like a bug in this tool and is not. There is no
    // watcher, and no answer can be given without one.
    await expect(readVantage('http://127.0.0.1:1')).rejects.toThrow(
      /nothing answered at `http:\/\/127\.0\.0\.1:1`.*variance watch/s,
    );
  });

  it('is told a stopped watcher took the run with it', async () => {
    const one = await watcher();
    const address = one.address;
    await one.close();
    started.length = 0;

    await expect(readVantage(address)).rejects.toThrow('cannot be asked about the run it held');
  });

  it('is told when the address is not an address at all', async () => {
    await expect(readVantage('127.0.0.1:4100')).rejects.toThrow('is not an address');
  });
});
