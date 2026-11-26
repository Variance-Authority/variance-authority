/**
 * A record with every packed run stored as its plain bytes.
 *
 * A run carries its own codec tag, so a record whose runs are all raw is still
 * a record of the same format, and every reader of the format opens it. It is
 * for a reader that has no zstd: the page `variance view` writes is compressed
 * whole with what the browser inflates, and its runs need nothing more.
 *
 * Nothing is dropped: a section that is itself framed is followed into, and
 * one that is not packed is carried as it is.
 */
import { decompress, HEAD, laid } from './column-codec.js';
import { framedHeader, sections, type Stored } from './format-layout.js';
import { fail } from './format-validation.js';
import { LAYOUT } from './record-layout.js';

const RAW = Buffer.of(LAYOUT.codecs.raw);

/** `record` with its runs raw; bytes that are not framed as a record is are returned as they are. */
export function rawRecord(record: Uint8Array): Uint8Array {
  const header = framedHeader(record);
  if (header === undefined) return record;
  const base = 4 + view(record).readUInt32LE(0);
  const held: Record<string, Stored> = {};
  for (const { name, offset, length, width, rows } of header.sections) {
    if (base + offset + length > record.length) fail();
    const bytes = record.subarray(base + offset, base + offset + length);
    if (rows === undefined) {
      const plain = view(rawRecord(bytes));
      held[name] = { plain, rows: plain.length / width, width };
    } else {
      const packed = rawRuns(view(bytes));
      held[name] = { plain: packed, rows, width, packed };
    }
  }
  return sections(held, header.version);
}

function rawRuns(section: Buffer): Buffer {
  if (section.length < HEAD) fail();
  const count = section.readUInt32LE(0);
  const at = HEAD + 4 * (count + 1);
  if (at > section.length) fail();
  const runs: Buffer[] = [];
  for (let run = 0; run < count; run += 1) {
    const from = at + section.readUInt32LE(HEAD + 4 * run);
    const to = at + section.readUInt32LE(HEAD + 4 * (run + 1));
    if (from >= to || to > section.length) fail();
    runs.push(Buffer.concat([RAW, decompress(section.subarray(from, to))]));
  }
  return laid(runs);
}

function view(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
